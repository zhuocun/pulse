<!-- orchestrate handoff
task: be-fe-tool-name-constants
branch: orch/code-smell-sweep-2-9be8/be-fe-tool-name-constants
agentId: bc-d8acbf74-5012-413a-8e8e-93164f497090
runId: run-31de38c2-74c3-4bd5-9ef7-7ca1e29b4346
resultStatus: finished
finishedAt: 2026-05-18T17:51:12.677Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/be-fe-tool-name-constants`

## What I did
- Added `backend/app/tools/fe_tool_names.py` with 13 `FE_*` constants (`FE_BOARD_SNAPSHOT`, `FE_SIMILAR_TASKS`, `FE_SEARCH_CANDIDATES`, `FE_APPLY_MUTATION`, `FE_VIEWER_CONTEXT`, etc.) and an `ALL_FE_TOOL_NAMES` frozenset.
- Updated `fe_tool_schemas.py` so `FE_TOOL_SCHEMAS` dict keys use the new constants instead of inline `"fe.*"` strings.
- Replaced mechanical literals in catalog interrupt helpers and `AgentMetadata.tools` tuples across `_shared.py`, `board_brief.py`, `task_drafting.py`, `task_estimation.py`, `search.py`, and `chat.py`.
- Opened draft PR #247 against `main`.

## Measurements
- `ruff check app/tools/ app/agents/catalog/_shared.py`: 0 errors → 0 errors
- `python -m pytest tests/test_tools.py tests/test_search_agent_v21.py -q --no-cov`: 73 passing → 73 passing

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- Scoped pytest without `--no-cov` exits non-zero due to the repo-wide 100% coverage gate on partial runs (73/73 tests still pass). Verifier should use `--no-cov` or the full suite for coverage.
- `triage.py` still has `"fe.boardSnapshot"` in its `tools=` tuple — out of scope for this task's allowed paths; same pattern can be applied there in a follow-up.
- `mcp_server.py` and test files retain string literals; not in scope but could reference `fe_tool_names` later for full deduplication.

## Suggested follow-ups
- Extend constant usage to `triage.py`, `mcp_server.py`, and test `_EXPECTED_TOOLS` sets for complete single-source-of-truth coverage.