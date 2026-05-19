<!-- orchestrate handoff
task: verify-fix-be-thread-id-strict
branch: `orch/bug-sweep-4e70/fix-be-thread-id-strict` (no verifier commits)
agentId: bc-7248cb60-9b41-44f1-8a90-b54b590e3fae
runId: run-de127792-aec2-45fd-a3fc-ec594c715d34
resultStatus: finished
finishedAt: 2026-05-19T05:30:20.883Z
-->

## Verification
`unit-test-verified`

## Target
`fix-be-thread-id-strict` on branch `orch/bug-sweep-4e70/fix-be-thread-id-strict`

## Branch
`orch/bug-sweep-4e70/fix-be-thread-id-strict` (no verifier commits)

## Execution
- → `git branch --show-current` → on `orch/bug-sweep-4e70/fix-be-thread-id-strict` at `e6665a2` ("Reject tampered signed thread_id tokens (B15)")
- → `source /workspace/.venv/bin/activate && cd /workspace/backend && python -m pytest tests/ -q -k thread` → **19 passed**, 1219 deselected in 3.44s; process exit **1** only because subset run reports 42% coverage vs `fail-under=100` in `pyproject.toml` (not a test failure)
- → `python -m pytest tests/test_agents.py::test_namespaced_thread_rejects_malformed_sigv1 tests/test_agents.py::test_tampered_signed_thread_key_rejected tests/test_agents.py::test_signed_thread_key_unsigned_fallback_still_works -v --no-cov` → **3 passed** in 0.03s (exit 0)
- → Read `backend/app/agents/runtime.py` `_namespaced_thread`: `sigv1.` / `sigv2.` with `original is None` now raises `InvalidThreadKeyError("Signed thread key rejected: invalid or tampered token")` instead of unsigned fallback

## Findings
Per acceptance criterion:
- [x] **Tampered signed thread keys are rejected** (met): `test_tampered_signed_thread_key_rejected` and `test_namespaced_thread_rejects_malformed_sigv1` both raise `InvalidThreadKeyError` with `code=invalid_thread_key`, `status_code=400`
- [x] **Valid unsigned ids still work** (met): `test_signed_thread_key_unsigned_fallback_still_works` passes; plain `my-plain-thread` → `echo:u1:my-plain-thread`

Other findings (severity-ordered):
- (low): Full recipe `pytest -k thread` exits non-zero on this repo whenever coverage gate runs on a subset; all 19 matching tests still pass — same behavior upstream reported

## Notes & suggestions
- B15 strict rejection is enforced at `_namespaced_thread` when verification returns `None` for prefixed tokens; low-level `_try_verify_signed_thread_key` still soft-fails with `None` (by design).
- No live HTTP/UI verification run; backend change is covered by unit tests only.
- Consider documenting that `-k thread` subset runs should use `--no-cov` locally to avoid misleading exit code 1.