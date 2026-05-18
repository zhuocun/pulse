<!-- orchestrate handoff
task: verify-be-fe-tool-name-constants
branch: `orch/code-smell-sweep-2-9be8/be-fe-tool-name-constants` (commit `d6df6c8` — verifier log only)
agentId: bc-9a3f97f8-68c4-431c-87e7-2a5ae70508a9
runId: run-4c65e2b2-fd41-4f34-9909-1cf1177e2d19
resultStatus: finished
finishedAt: 2026-05-18T17:52:58.062Z
-->

## Verification

`unit-test-verified`

## Target
`be-fe-tool-name-constants` on branch `orch/code-smell-sweep-2-9be8/be-fe-tool-name-constants`

## Branch
`orch/code-smell-sweep-2-9be8/be-fe-tool-name-constants` (commit `d6df6c8` — verifier log only)

## Execution
- → `source /workspace/.venv/bin/activate && cd /workspace/backend && ruff check app/tools/ app/agents/catalog/_shared.py` → exit 0, `All checks passed!`
- → `source /workspace/.venv/bin/activate && cd /workspace/backend && python -m pytest tests/test_tools.py tests/test_search_agent_v21.py -q --no-cov` → exit 0, `73 passed in 0.26s`
- → Read-only: confirmed `backend/app/tools/fe_tool_names.py` defines 13 `FE_*` constants plus `ALL_FE_TOOL_NAMES` frozenset; `fe_tool_schemas.py` uses those constants as `FE_TOOL_SCHEMAS` keys; catalog files in scope (`_shared.py`, `board_brief.py`, `task_drafting.py`, `task_estimation.py`, `search.py`, `chat.py`) import from `fe_tool_names` with no remaining `"fe.*"` literals in `_shared.py`
- → Committed/pushed `.orchestrate/code-smell-sweep-2-9be8/verification/be-fe-tool-name-constants-verifier.log`

## Findings
Per acceptance criterion:
- [x]: Shared constants module exists — `backend/app/tools/fe_tool_names.py` with 13 `FE_*` names and `ALL_FE_TOOL_NAMES`
- [x]: ruff + scoped pytest pass — both recipe commands exit 0 with clean output

Other findings (severity-ordered):
- (low): `backend/app/agents/catalog/triage.py:298` still has inline `"fe.boardSnapshot"` in `tools=`; worker noted out of scope — follow-up for full single-source-of-truth
- (low): `mcp_server.py` and test files retain `"fe.*"` string literals; acceptable for this task scope

## Notes & suggestions
- Scoped pytest without `--no-cov` may fail the repo 100% coverage gate on partial runs; recipe used `--no-cov` per upstream guidance — all 73 tests passed.
- Extend constant usage to `triage.py`, `mcp_server.py`, and test `_EXPECTED_TOOLS` sets if the sweep wants complete deduplication.