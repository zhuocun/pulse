"""LLM-as-judge scoring for the Board Copilot eval harness.

Two judge implementations are provided:

- :class:`LLMJudge` calls a real chat model (Anthropic Claude by default)
  via LangChain's ``with_structured_output``.  Each criterion is scored
  0..1; the overall score is the weighted sum.  The prompt is laid out so
  the rubric block is identical across fixtures of the same agent —
  Anthropic prompt-caching can amortise the ~1k-token rubric across the
  whole eval run.

- :class:`StubJudge` is the CI-safe fallback.  It scores ``1.0`` only when
  every ``must_have`` substring is present in the rendered output and no
  ``must_not`` substring appears.  Each rubric criterion gets the same
  score so the runner aggregation still has shape parity with the LLM
  path.

The :func:`judge_output` free function dispatches to whichever judge is
passed.  When ``judge`` is ``None`` and ``model`` is not provided, the
function constructs a :class:`StubJudge` — safe by default.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional, Protocol, Sequence

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.eval.fixtures import EvalFixture
from app.eval.rubrics import RubricCriterion

logger = logging.getLogger(__name__)


DEFAULT_JUDGE_MODEL = "claude-sonnet-4-6"
LOW_COST_JUDGE_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_PASS_THRESHOLD = 0.7


class JudgeResult(BaseModel):
    """Structured output schema for the judge.

    ``criteria`` maps criterion name → 0..1 score.  ``overall`` is the
    weighted aggregate computed by the runner (or by the LLM when it
    reasons holistically — the runner re-computes either way for
    consistency).
    """

    model_config = ConfigDict(extra="forbid")

    overall: float = Field(..., ge=0.0, le=1.0)
    criteria: dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""
    passed: bool = False

    @field_validator("criteria")
    @classmethod
    def _criteria_in_range(cls, value: dict[str, float]) -> dict[str, float]:
        for name, score in value.items():
            if not 0.0 <= float(score) <= 1.0:
                raise ValueError(
                    f"Criterion {name!r} score {score!r} must be in [0, 1]."
                )
        return value


class Judge(Protocol):
    """Interface that the runner consumes."""

    def __call__(
        self,
        fixture: EvalFixture,
        output: Any,
        rubric: Sequence[RubricCriterion],
        *,
        threshold: float = DEFAULT_PASS_THRESHOLD,
    ) -> JudgeResult:
        ...


# ---------------------------------------------------------------------------
# Stub judge — deterministic, no API calls
# ---------------------------------------------------------------------------


def _stringify_output(output: Any) -> str:
    """Best-effort flatten of an agent output into a single string blob.

    For agent-runtime outputs of the shape ``{"final_state": ..., "events":
    [...]}`` (produced by :func:`app.eval.runner._default_agent_caller`),
    only the *generated* parts are rendered: the events list and the
    string content of any messages.  The original input snapshot threaded
    through state is intentionally excluded so ``must_have`` / ``must_not``
    substring checks target the agent's own output rather than the data
    it was handed.

    For arbitrary outputs (e.g. when a custom ``agent_fn`` is used in
    tests) the whole object is serialized to JSON.
    """

    if isinstance(output, str):
        return output
    if isinstance(output, dict) and "events" in output and "final_state" in output:
        generated: dict[str, Any] = {"events": output.get("events") or []}
        final_state = output.get("final_state") or {}
        if isinstance(final_state, dict):
            # Surface only the agent's own contributions, never the
            # snapshot / candidates / similar_tasks the FE handed in.
            for key in (
                "brief",
                "draft",
                "estimate",
                "readiness",
                "ranking",
                "nudges",
                "mutation_pending",
            ):
                if key in final_state and final_state[key] is not None:
                    generated[key] = final_state[key]
            messages = final_state.get("messages") or []
            generated["messages"] = [
                getattr(msg, "content", None) if hasattr(msg, "content") else msg
                for msg in messages
            ]
        try:
            return json.dumps(generated, default=str, sort_keys=True)
        except TypeError:
            return repr(generated)
    try:
        return json.dumps(output, default=str, sort_keys=True)
    except TypeError:
        return repr(output)


class StubJudge:
    """Deterministic judge — used in CI and as a sanity baseline.

    Scoring rule:

    - Every criterion receives the same score.
    - If any ``must_not`` string is present in the rendered output the
      score is 0.0.
    - Otherwise the score equals the fraction of ``must_have`` strings
      present in the rendered output (1.0 when the list is empty).
    """

    name = "stub"

    def __call__(
        self,
        fixture: EvalFixture,
        output: Any,
        rubric: Sequence[RubricCriterion],
        *,
        threshold: float = DEFAULT_PASS_THRESHOLD,
    ) -> JudgeResult:
        rendered = _stringify_output(output).lower()
        for forbidden in fixture.must_not:
            if forbidden.lower() in rendered:
                criteria = {c.name: 0.0 for c in rubric}
                return JudgeResult(
                    overall=0.0,
                    criteria=criteria,
                    reasoning=(
                        f"StubJudge: forbidden substring "
                        f"{forbidden!r} found in output."
                    ),
                    passed=False,
                )
        if not fixture.must_have:
            score = 1.0
        else:
            hits = sum(
                1 for needle in fixture.must_have if needle.lower() in rendered
            )
            score = hits / len(fixture.must_have)
        criteria = {c.name: score for c in rubric}
        overall = sum(score * c.weight for c in rubric)
        return JudgeResult(
            overall=overall,
            criteria=criteria,
            reasoning=(
                f"StubJudge: {len([n for n in fixture.must_have if n.lower() in rendered])}"
                f"/{len(fixture.must_have)} must_have substrings matched."
            ),
            passed=overall >= threshold,
        )


# ---------------------------------------------------------------------------
# LLM judge — Anthropic Claude by default
# ---------------------------------------------------------------------------


_JUDGE_SYSTEM_PROMPT = (
    "You are an evaluation judge for the Board Copilot agent system. "
    "You receive an agent's output and a rubric of criteria, and you "
    "return a JSON object scoring each criterion in [0.0, 1.0]. "
    "Be strict, terse, and consistent. Do not invent criteria; score "
    "only the criteria provided.  When a criterion is unscorable from "
    "the available evidence, score it 0.5 and note the reason in the "
    "reasoning field. Never refuse to score; never apologise."
)


def _render_rubric_block(rubric: Sequence[RubricCriterion]) -> str:
    """Serialize the rubric as a stable, cache-friendly block.

    Sorted by criterion name so the cached prefix is identical across
    fixtures of the same agent.
    """

    lines = ["Rubric (each criterion scored independently, 0.0 to 1.0):"]
    for c in sorted(rubric, key=lambda x: x.name):
        lines.append(f"- {c.name} (weight {c.weight:.2f}): {c.description}")
    return "\n".join(lines)


def _render_fixture_block(fixture: EvalFixture, output: Any) -> str:
    must_have = (
        ", ".join(repr(s) for s in fixture.must_have) if fixture.must_have else "(none)"
    )
    must_not = (
        ", ".join(repr(s) for s in fixture.must_not) if fixture.must_not else "(none)"
    )
    return (
        f"Fixture id: {fixture.id}\n"
        f"Agent: {fixture.agent}\n"
        f"Must-have substrings/concepts: {must_have}\n"
        f"Must-not substrings/concepts: {must_not}\n"
        f"\n"
        f"Agent input (JSON):\n{json.dumps(fixture.input, indent=2, default=str)}\n"
        f"\n"
        f"Agent output (JSON):\n{_stringify_output(output)}\n"
    )


class LLMJudge:
    """LLM-as-judge implementation.

    The model is resolved lazily so importing the module never touches a
    provider.  ``provider`` selects between ``anthropic`` and ``openai``;
    the default is Anthropic Claude Sonnet because it scores cheaply and
    benefits from prompt caching on the rubric prefix.
    """

    name = "llm"

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        provider: str = "anthropic",
        temperature: float = 0.0,
        client: Any = None,
    ) -> None:
        self._model_name = model or DEFAULT_JUDGE_MODEL
        self._provider = provider
        self._temperature = temperature
        # ``client`` is the LangChain ``BaseChatModel`` instance.  Resolved
        # lazily so module import is side-effect free.
        self._client: Any = client

    @property
    def model_name(self) -> str:
        return self._model_name

    def _resolve_client(self) -> Any:
        if self._client is not None:
            return self._client
        if self._provider == "anthropic":
            try:
                from langchain_anthropic import ChatAnthropic
            except ImportError as exc:  # pragma: no cover - exercised by env without dep
                raise RuntimeError(
                    "LLMJudge requires langchain-anthropic; install with "
                    "`pip install '.[anthropic]'` or pass a pre-built client."
                ) from exc
            if "ANTHROPIC_API_KEY" not in os.environ:
                raise RuntimeError(
                    "LLMJudge: ANTHROPIC_API_KEY is not set.  Either export "
                    "it, or pass a pre-built client, or use the StubJudge."
                )
            self._client = ChatAnthropic(
                model=self._model_name,
                temperature=self._temperature,
            )
            return self._client
        if self._provider == "openai":
            try:
                from langchain_openai import ChatOpenAI
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "LLMJudge requires langchain-openai for the openai provider."
                ) from exc
            if "OPENAI_API_KEY" not in os.environ:
                raise RuntimeError(
                    "LLMJudge: OPENAI_API_KEY is not set.  Either export it "
                    "or pass a pre-built client."
                )
            self._client = ChatOpenAI(
                model=self._model_name,
                temperature=self._temperature,
            )
            return self._client
        raise ValueError(
            f"LLMJudge: unknown provider {self._provider!r}; expected "
            f"'anthropic' or 'openai'."
        )

    def __call__(
        self,
        fixture: EvalFixture,
        output: Any,
        rubric: Sequence[RubricCriterion],
        *,
        threshold: float = DEFAULT_PASS_THRESHOLD,
    ) -> JudgeResult:
        client = self._resolve_client()
        # Cache-friendly layout: system prompt + rubric form the stable
        # prefix; fixture content is the per-call suffix.
        from langchain_core.messages import HumanMessage, SystemMessage

        rubric_block = _render_rubric_block(rubric)
        fixture_block = _render_fixture_block(fixture, output)

        # Mark the system + rubric block for Anthropic prompt caching.  The
        # ``cache_control`` key is forwarded verbatim by
        # ``langchain-anthropic`` and ignored by other providers.
        system_msg = SystemMessage(
            content=[
                {
                    "type": "text",
                    "text": _JUDGE_SYSTEM_PROMPT + "\n\n" + rubric_block,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        )
        criteria_names = [c.name for c in rubric]
        user_msg = HumanMessage(
            content=(
                fixture_block
                + "\n"
                + "Return a JSON object with keys:\n"
                + "- overall: float in [0,1]\n"
                + f"- criteria: object with exactly these keys: {criteria_names}\n"
                + "- reasoning: brief justification (<= 4 sentences)\n"
                + "- passed: boolean (overall >= threshold)\n"
            )
        )

        try:
            structured = client.with_structured_output(JudgeResult)
            result = structured.invoke([system_msg, user_msg])
        except Exception:  # noqa: BLE001 — robust fallback
            logger.exception(
                "LLMJudge.invoke failed for fixture %r; recording 0.0 score.",
                fixture.id,
            )
            return JudgeResult(
                overall=0.0,
                criteria={name: 0.0 for name in criteria_names},
                reasoning="LLMJudge failed to produce a structured response.",
                passed=False,
            )

        # Re-compute overall from criteria so the judge can't accidentally
        # inflate the headline score relative to its per-criterion
        # judgments.
        weights = {c.name: c.weight for c in rubric}
        recomputed = 0.0
        for name, score in result.criteria.items():
            recomputed += float(score) * weights.get(name, 0.0)
        recomputed = max(0.0, min(1.0, recomputed))
        return JudgeResult(
            overall=recomputed,
            criteria=dict(result.criteria),
            reasoning=result.reasoning,
            passed=recomputed >= threshold,
        )


# ---------------------------------------------------------------------------
# Free function — convenience dispatcher
# ---------------------------------------------------------------------------


def judge_output(
    fixture: EvalFixture,
    output: Any,
    rubric: Sequence[RubricCriterion],
    *,
    judge: Optional[Judge] = None,
    threshold: float = DEFAULT_PASS_THRESHOLD,
    model: Optional[str] = None,
) -> JudgeResult:
    """Dispatch helper.

    - When ``judge`` is supplied, it is called directly.
    - When ``judge`` is ``None`` and ``model`` is non-empty, an
      :class:`LLMJudge` is constructed for this call.
    - Otherwise a :class:`StubJudge` is used.  This is the safe default
      for CI and for ``--dry-run`` planning.
    """

    if judge is None:
        if model:
            judge = LLMJudge(model=model)
        else:
            judge = StubJudge()
    return judge(fixture, output, rubric, threshold=threshold)
