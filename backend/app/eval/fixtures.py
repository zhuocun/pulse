"""Fixture format + loader for the Board Copilot eval harness.

Fixtures live as JSON files under
``backend/tests/eval/fixtures/<agent>/<id>.json``.  Each file is a single
:class:`EvalFixture` payload — *not* a list — so a fixture id can be
referenced directly from the filename and discovered by ``ls``.

Adding a fixture is a pure file-system operation; no Python edits required.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


AGENT_NAMES = (
    "chat",
    "board_brief",
    "search",
    "triage",
    "task_drafting",
    "task_estimation",
)

AgentName = Literal[
    "chat",
    "board_brief",
    "search",
    "triage",
    "task_drafting",
    "task_estimation",
]


# Map the short fixture-agent slug to the registered runtime agent name.
# Fixture authors and the CLI use the short slug because it matches the
# directory name; the runner uses :func:`agent_runtime_name` to translate
# when invoking a registered agent.
_RUNTIME_NAME = {
    "chat": "chat-agent",
    "board_brief": "board-brief-agent",
    "search": "search-agent",
    "triage": "triage-agent",
    "task_drafting": "task-drafting-agent",
    "task_estimation": "task-estimation-agent",
}


def agent_runtime_name(agent: str) -> str:
    """Translate a fixture-agent slug to its registered runtime name."""
    try:
        return _RUNTIME_NAME[agent]
    except KeyError as exc:
        raise ValueError(
            f"Unknown eval agent slug {agent!r}; expected one of {AGENT_NAMES}."
        ) from exc


class EvalFixture(BaseModel):
    """One evaluation case for a Board Copilot agent.

    Attributes:
        id: Stable identifier (filename stem).  Surfaces in reports.
        agent: Short slug identifying the target agent.
        input: Agent-specific request payload (the shape ``AgentRuntime``
            consumes via ``arun_with_events``).
        must_have: Substrings or concepts that MUST appear in the output.
            Both the LLM judge and the :class:`StubJudge` enforce these.
        must_not: Substrings or concepts that MUST NOT appear.  Useful
            for adversarial prompts and policy refusals.
        rubric_overrides: Optional per-criterion weight or description
            overrides applied on top of :data:`RUBRICS`.  A criterion may
            be added (``{"new_criterion": {"weight": 0.1, "description":
            "..."}}``) or partially overridden (``{"existing": {"weight":
            0.4}}``).
        notes: Free-form prose for fixture authors and reviewers.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    agent: AgentName
    input: dict[str, Any]
    must_have: list[str] = Field(default_factory=list)
    must_not: list[str] = Field(default_factory=list)
    rubric_overrides: Optional[dict[str, dict[str, Any]]] = None
    notes: str = ""

    @field_validator("id")
    @classmethod
    def _id_no_slashes(cls, value: str) -> str:
        if "/" in value or "\\" in value:
            raise ValueError("Fixture id must not contain path separators.")
        return value


def fixtures_root() -> Path:
    """Return the on-disk root for fixture JSON files.

    Resolved at call time (not import time) so tests can monkeypatch the
    constant or override it via environment in the future.
    """

    # ``__file__`` is ``backend/app/eval/fixtures.py``.  Step out to
    # ``backend/`` then into ``tests/eval/fixtures``.
    return Path(__file__).resolve().parents[2] / "tests" / "eval" / "fixtures"


def _iter_fixture_files(root: Path, agent: Optional[str]) -> Iterable[Path]:
    if agent is None:
        for name in AGENT_NAMES:
            yield from sorted((root / name).glob("*.json"))
    else:
        if agent not in AGENT_NAMES:
            raise ValueError(
                f"Unknown agent slug {agent!r}; expected one of {AGENT_NAMES}."
            )
        yield from sorted((root / agent).glob("*.json"))


def load_fixtures(
    agent: Optional[str] = None,
    *,
    root: Optional[Path] = None,
) -> list[EvalFixture]:
    """Load every fixture for ``agent`` (or all agents when ``agent`` is None).

    Files are read in sorted order so reports are deterministic.  Validation
    errors propagate so a typo in a fixture fails loudly rather than
    silently truncating the eval set.
    """

    resolved_root = root if root is not None else fixtures_root()
    fixtures: list[EvalFixture] = []
    for path in _iter_fixture_files(resolved_root, agent):
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        # Allow the fixture file to omit ``id``; the filename is canonical.
        data.setdefault("id", path.stem)
        # Allow omitting the agent when the directory disambiguates it.
        data.setdefault("agent", path.parent.name)
        fixtures.append(EvalFixture.model_validate(data))
    return fixtures
