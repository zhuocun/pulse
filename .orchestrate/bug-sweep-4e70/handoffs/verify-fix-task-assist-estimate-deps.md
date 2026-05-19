<!-- orchestrate handoff
task: verify-fix-task-assist-estimate-deps
branch: `orch/bug-sweep-4e70/fix-task-assist-estimate-deps` (pushed commit `700628b` — verifier log + handoff only)
agentId: bc-9ced81ce-87e2-4eda-a18f-a075cda8f27c
runId: run-5708e58f-e9c6-4794-95e2-3bb98e477875
resultStatus: finished
finishedAt: 2026-05-19T05:31:01.539Z
-->

## Verification

`unit-test-verified`

## Target

`fix-task-assist-estimate-deps` on branch `orch/bug-sweep-4e70/fix-task-assist-estimate-deps`

## Branch

`orch/bug-sweep-4e70/fix-task-assist-estimate-deps` (pushed commit `700628b` — verifier log + handoff only)

## Execution

- Checked out `orch/bug-sweep-4e70/fix-task-assist-estimate-deps` at worker commit `19934cd` (B5 product fix unchanged by verifier).
- Ran **`CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskAssistPanel`** → **4 suites, 24 tests, 0 failures** (~4.5s).
- Ran **`npx tsc --noEmit`** → **exit 0**.
- Read-only review: remote estimate effect deps are `[trimmedName, isRemote, remoteInput, startRemoteEstimate]`; `remoteInput` memo uses draft fields only (no `tasks`).
- Confirmed regression tests in `agent.test.tsx`:
  - `does not restart the remote agent when unrelated tasks cache updates leave the draft unchanged` — QueryClient adds a task; `start` stays at 1 call after debounce.
  - `restarts the remote agent when debounced draft fields change` — `start` called twice; last call has `task_draft.taskName: "Implement OAuth login v2"`.
- Committed artifact `.orchestrate/bug-sweep-4e70/verification/fix-task-assist-estimate-deps-verifier.log` and handoff; pushed to same branch.
- Live browser / board UI: **not run**.

## Findings

Per acceptance criterion:

- **[x] Unrelated tasks list updates do not restart remote estimate when draft fields unchanged** — **met** (dedicated test + effect deps exclude bare `tasks`).
- **[x] Estimate still runs when debounced draft fields change** — **met** (dedicated test asserts second `start` with updated `task_draft`).

Other findings (severity-ordered):

- **(low)**: Local-engine path still re-runs on `localAiContext` changes (includes `tasks`); worker noted as intentional and out of B5 scope.

## Notes & suggestions

- Verdict **`unit-test-verified`**: recipe commands passed; both B5 acceptance criteria are covered by targeted Jest cases, not diff-only review.
- Optional follow-up: stable fingerprint for `localAiContext` if local estimate should also ignore referentially-new task arrays.