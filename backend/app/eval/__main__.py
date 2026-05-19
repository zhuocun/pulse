"""CLI entry point for the Board Copilot eval harness.

Usage examples::

    # Plan only — no API calls, no agent invocation
    python -m app.eval --dry-run --agent all

    # CI smoke run — stub judge, stub agent path
    python -m app.eval --agent task_drafting --judge stub

    # Full live run for one agent
    python -m app.eval --agent chat --judge claude --max-fixtures 10 \\
        --output reports/eval-chat.json

Cost protection
---------------
``--max-fixtures`` caps the number of judged fixtures.  ``--dry-run``
short-circuits before any model call.  ``--judge stub`` skips the LLM
judge entirely.  The CLI exits with a non-zero status when any fixture
fails so it composes with CI / make targets.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Optional, Sequence

from app.eval.fixtures import AGENT_NAMES
from app.eval.judge import (
    DEFAULT_JUDGE_MODEL,
    DEFAULT_PASS_THRESHOLD,
    LLMJudge,
    StubJudge,
)
from app.eval.runner import EvalReport, run_eval


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.eval",
        description="Run the Board Copilot eval harness.",
    )
    parser.add_argument(
        "--agent",
        choices=(*AGENT_NAMES, "all"),
        default="all",
        help="Agent slug to evaluate, or 'all' (default).",
    )
    parser.add_argument(
        "--max-fixtures",
        type=int,
        default=None,
        help="Cap on the number of fixtures judged (cost protection).",
    )
    parser.add_argument(
        "--judge",
        choices=("claude", "stub"),
        default="stub",
        help="Which judge to use (default: stub — no API calls).",
    )
    parser.add_argument(
        "--judge-model",
        default=DEFAULT_JUDGE_MODEL,
        help=f"Model id for the LLM judge (default: {DEFAULT_JUDGE_MODEL}).",
    )
    parser.add_argument(
        "--judge-provider",
        choices=("anthropic", "openai"),
        default="anthropic",
        help="LLM provider for the judge (default: anthropic).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Path to write the JSON report (omitted -> stdout summary only).",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_PASS_THRESHOLD,
        help=(
            f"Overall score required to pass a fixture "
            f"(default: {DEFAULT_PASS_THRESHOLD})."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Load fixtures and print plan; do NOT invoke any model or agent.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose logging.",
    )
    return parser


def _build_judge(args: argparse.Namespace):
    if args.judge == "stub":
        return StubJudge()
    return LLMJudge(model=args.judge_model, provider=args.judge_provider)


def _print_summary(report: EvalReport, *, stream=sys.stdout) -> None:
    print(
        f"Eval summary  agents={report.agents}  judge={report.judge}  "
        f"threshold={report.threshold:.2f}",
        file=stream,
    )
    print(
        f"  total={report.total}  passed={report.passed}  failed={report.failed}  "
        f"pass_rate={report.pass_rate:.1%}  mean_overall={report.mean_overall:.3f}",
        file=stream,
    )
    if report.mean_criteria:
        print("  mean criteria:", file=stream)
        for name, score in sorted(report.mean_criteria.items()):
            print(f"    {name:<32} {score:.3f}", file=stream)
    if report.failed:
        print("  failures:", file=stream)
        for r in report.results:
            if r.passed:
                continue
            tag = "ERROR" if r.error else "FAIL"
            print(
                f"    [{tag}] {r.agent:<16} {r.fixture_id:<40} "
                f"overall={r.overall:.2f}",
                file=stream,
            )
            if r.reasoning:
                snippet = r.reasoning.strip().splitlines()[0][:140]
                print(f"           {snippet}", file=stream)


def _emit_report(report: EvalReport, output: Optional[Path]) -> None:
    if output is None:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report.to_dict(), indent=2, default=str))


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    judge = _build_judge(args)
    report = asyncio.run(
        run_eval(
            args.agent,
            judge=judge,
            max_fixtures=args.max_fixtures,
            dry_run=args.dry_run,
            threshold=args.threshold,
        )
    )
    _print_summary(report)
    _emit_report(report, args.output)

    # Non-zero exit on any failure (useful for CI gates).  Dry-run always
    # exits 0 because no scoring happened.
    if args.dry_run:
        return 0
    return 0 if report.failed == 0 else 1


if __name__ == "__main__":  # pragma: no cover — exercised via subprocess
    raise SystemExit(main())
