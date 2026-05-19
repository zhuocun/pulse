<!-- orchestrate handoff
task: verify-fix-task-assist-estimate-deps
branch: `orch/bug-sweep-4e70/fix-task-assist-estimate-deps`
resultStatus: finished
-->

## Verification

`unit-test-verified`

## Target

`fix-task-assist-estimate-deps` on branch `orch/bug-sweep-4e70/fix-task-assist-estimate-deps`

## Branch

`orch/bug-sweep-4e70/fix-task-assist-estimate-deps` (verifier log + handoff only)

## Execution

- Confirmed checkout on `orch/bug-sweep-4e70/fix-task-assist-estimate-deps` at `19934cd`.
- **`CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskAssistPanel`** — **passed**: 4 suites, **24 tests**, 0 failures (~4.5s).
- **`npx tsc --noEmit`** — **exit 0**.
- **Code review (read-only)**: remote estimate `useEffect` deps are `[trimmedName, isRemote, remoteInput, startRemoteEstimate]` with no bare `tasks`; `remoteInput` memo depends only on debounced draft fields.
- **Test coverage vs acceptance criteria**:
  - `agent.test.tsx` — `does not restart the remote agent when unrelated tasks cache updates leave the draft unchanged` (QueryClient bumps tasks array; `start` stays at 1 call).
  - `agent.test.tsx` — `restarts the remote agent when debounced draft fields change` (`start` called twice; last call includes updated `task_draft.taskName`).
- **Artifact**: `.orchestrate/bug-sweep-4e70/verification/fix-task-assist-estimate-deps-verifier.log` (command transcript).
- **Live UI / browser**: not run.

## Findings

Per acceptance criterion:

- **[x] Unrelated tasks list updates do not restart remote estimate when draft fields unchanged** — **met** (regression test + effect deps exclude `tasks`).
- **[x] Estimate still runs when debounced draft fields change** — **met** (regression test asserts second `start` with updated `task_draft`).

Other findings (severity-ordered):

- **(low)** Local-engine estimate path still depends on `localAiContext` (includes `tasks`); upstream noted this is intentional and out of B5 scope.

## Notes & suggestions

- B5 verifier signal is **`unit-test-verified`** — targeted Jest cases exercise both acceptance criteria; TypeScript clean.
- Optional follow-up (worker note): stable fingerprint for `localAiContext` if local estimate should ignore referentially-new task arrays.
