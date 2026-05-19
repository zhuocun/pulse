<!-- orchestrate handoff
task: fix-be-thread-id-strict
branch: orch/bug-sweep-4e70/fix-be-thread-id-strict
agentId: bc-33c8113a-0fb9-4d7f-8894-3d6283a59ff1
runId: run-d52a2ab5-7d8a-4e1e-85f6-a5e05c42468e
resultStatus: finished
finishedAt: 2026-05-19T05:28:46.050Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-be-thread-id-strict`

## What I did
- Updated `_namespaced_thread` in `backend/app/agents/runtime.py` so `sigv1.` / `sigv2.` tokens that fail verification raise `InvalidThreadKeyError` instead of falling through to unsigned namespace handling.
- Adjusted `_try_verify_signed_thread_key` docstring to note prefixed `None` must be rejected upstream.
- Replaced `test_namespaced_thread_treats_malformed_sigv1_as_unsigned` with `test_namespaced_thread_rejects_malformed_sigv1` expecting `InvalidThreadKeyError`.
- Added `test_tampered_signed_thread_key_rejected` for a valid-structure `sigv1.` token with a bad HMAC.
- Pushed branch and opened draft PR [#258](https://github.com/zhuocun/pulse/pull/258).

## Measurements
- `pytest tests/ -q -k thread` (backend): 19 passing → 19 passing

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Low-level `_try_verify_signed_thread_key` still returns `None` on malformed/tampered input; only `_namespaced_thread` enforces strict rejection for prefixed tokens. Unsigned plain IDs are unchanged (`test_signed_thread_key_unsigned_fallback_still_works` still applies).
- `BUG-SWEEP-AUDIT.md` was not present in the workspace; implemented from the task brief and existing tests.
- Subset pytest run exits non-zero only because project `fail-under=100` coverage applies even with `-k thread`; all 19 matching tests passed.

## Suggested follow-ups
- Consider tightening `_verify_sigv2` unknown-kid behavior separately if retired-key rotation should also hard-fail at the namespaced layer (currently still returns `None` at verify layer, now rejected in `_namespaced_thread`).