<!-- orchestrate handoff
task: verify-fix-ai-draft-modal-guards
branch: `orch/bug-sweep-4e70/fix-ai-draft-modal-guards` (no verifier commits; read-only verification)
agentId: bc-7709f116-51d3-47c5-b91a-b5ba0894e8d7
runId: run-52faaa4b-0fa5-4b15-9772-0b85c00e4088
resultStatus: finished
finishedAt: 2026-05-19T05:31:03.755Z
-->

## Verification
`unit-test-verified`

## Target
`fix-ai-draft-modal-guards` on branch `orch/bug-sweep-4e70/fix-ai-draft-modal-guards`

## Branch
`orch/bug-sweep-4e70/fix-ai-draft-modal-guards` (no verifier commits; read-only verification)

## Execution
- → Confirmed checkout on `orch/bug-sweep-4e70/fix-ai-draft-modal-guards` (`git branch --show-current`)
- → `CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskDraftModal` — **2 suites, 20 tests passed** (exit 0)
- → `npx tsc --noEmit` — **clean** (exit 0)
- → Read implementation/tests to map B6/B7 to exercised paths (no source edits)

**Test output (first run):**
```
Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total
Time:        8.667 s
Ran all test suites matching src/components/aiTaskDraftModal.
```

## Findings
Per acceptance criterion:
- **[x] Whitespace-only task names fail validation:** **met** — `taskName` rules include `whitespace: true` + `taskNameRequired` in `index.tsx`; local test `rejects a whitespace-only task name on create` (`index.test.tsx`) and remote test with pre-seeded `lastSuggestion` (`agent.test.tsx`) both assert create does not call `fetch`.
- **[x] Remote suggestions pass through `validateDraft` before populating the form:** **met** — remote `useEffect` calls `validateDraft(payload, draftValidateContext)` before `form.setFieldsValue(draft)`; `clamps invalid column and coordinator ids from remote draft suggestions` proves invalid IDs are clamped to board fallbacks (Todo / Alice).

Other findings (severity-ordered):
- None blocking B6/B7.

## Notes & suggestions
- Validation-only change; targeted unit tests are sufficient — no live UI run.
- Upstream note stands: consider `validateBreakdown` parity on the local breakdown path (out of scope for B6/B7).