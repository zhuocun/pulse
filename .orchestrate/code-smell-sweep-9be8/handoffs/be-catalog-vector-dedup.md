<!-- orchestrate handoff
task: be-catalog-vector-dedup
branch: orch/code-smell-sweep-9be8/be-catalog-vector-dedup
agentId: bc-08b86384-2462-4729-b73d-130e9fbba9be
runId: run-7046b5e1-c63f-43b5-b2cb-6e4774b87383
resultStatus: finished
finishedAt: 2026-05-18T17:17:20.480Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-9be8/be-catalog-vector-dedup`

## What I did
- Added `augment_items_with_vector_neighbours` in `backend/app/agents/catalog/_shared.py` for the shared settings gate → `embed_async` → `fetch_vector_neighbours_for_project` → `merge_similar_with_vector_hits` flow, with documented `# noqa: BLE001` best-effort failure handling and caller-specific log messages.
- Replaced duplicated blocks in `task_estimation.fetch_embeddings` and `search.rank` with calls to that helper (`max_total=40` preserved for search).
- Removed unused `logging` / `logger` from `task_estimation.py` and `search.py` after moving warnings into `_shared.py`.
- Pushed branch and opened draft PR https://github.com/zhuocun/pulse/pull/239.

## Measurements
- `pytest tests/test_vector_augmented_agents.py`: 5 passing → 5 passing
- `ruff check` on touched catalog files: pass → pass
- duplicated vector-augment blocks in task_estimation + search: 2 → 0

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Discovery audit paths (`.orchestrate/...`) were not present in this workspace; implementation followed the task brief and existing duplicated code in the two agents.
- `pytest` was run with `--no-cov` because the repo’s default pytest config enforces 100% coverage on the full backend and fails on a single-file run (tests themselves all passed).
- Search still gates vector augment on `kind == "tasks"` at the call site; estimation uses default `max_total=24`, search passes `max_total=40` as before.
- Existing `test_vector_augmented_agents.py` required no changes; monkeypatches on `be_tools.embed_async` and `task_vector_pg.fetch_vector_neighbours_for_project` still work via lazy imports inside the helper.

## Suggested follow-ups
- Add a focused unit test for `augment_items_with_vector_neighbours` in `_shared.py` (early-return when settings disabled, merge kwargs) if orchestrator wants coverage on the helper without full graph invokes.