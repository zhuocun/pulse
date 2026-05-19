<!-- orchestrate handoff
task: verify-fix-chat-drawer-focus
branch: orch/bug-sweep-4e70/fix-chat-drawer-focus
agentId: bc-efb05b35-6ffe-46d6-8602-706181c49380
runId: run-3dc9065a-1e5f-4a2e-b374-fb99c646db62
resultStatus: finished
finishedAt: 2026-05-19T05:32:03.797Z
-->

## Verification

unit-test-verified

## Target
`fix-chat-drawer-focus` on branch `orch/bug-sweep-4e70/fix-chat-drawer-focus`

## Branch
`orch/bug-sweep-4e70/fix-chat-drawer-focus`

## Execution
- → Checked out `orch/bug-sweep-4e70/fix-chat-drawer-focus` at `9caeb21` (worker fix commit).
- → `CI=true npm test -- --watchAll=false --runInBand src/components/aiChatDrawer src/__tests__/aiAccessibility` → **3 suites, 57 tests, all passed** (12.4s first run; 10.1s second run).
- → `npx tsc --noEmit` → exit **0** (clean).
- → Inspected fix in `src/components/aiChatDrawer/index.tsx`: post-streaming effect now gates assistant focus behind `shouldFocusAssistantOnCompleteRef` (set only on Regenerate); when composer already has focus at loading→idle, focus stays on textarea.
- → Confirmed new regression test `does not move focus to the last assistant bubble when loading completes while the composer has focus` in `branches.test.tsx` spies `HTMLElement.prototype.focus` and asserts assistant group is not focused after simulated completion with composer focused.
- → Committed verifier artifact `.orchestrate/bug-sweep-4e70/verification/fix-chat-drawer-focus-verifier.log` (`85c1a6a`) and pushed to origin.

## Findings
Per acceptance criterion:
- **Keyboard users typing a follow-up are not kicked to last assistant bubble after each reply:** `[x]` met — targeted unit test passes; implementation removes blanket `lastAssistantRef.current.focus()` on every loading→idle transition.
- **jest-axe / existing aiAccessibility tests stay green:** `[x]` met — `aiAccessibility.strict.test.tsx` AiChatDrawer axe states (A/B/C) included in 57/57 passing run.

Other findings (severity-ordered):
- **(low):** No live browser / screen-recording verification performed; behavioral fix is covered by the new unit test plus existing jest-axe suites. Regenerate-only assistant focus path is implemented but not separately asserted in tests.

## Notes & suggestions
- Verifier did not modify worker source files; only appended execution log under `.orchestrate/bug-sweep-4e70/verification/`.
- Optional follow-up (from upstream): integration test sending real messages via `useAiChat`, and a regenerate-path test confirming assistant bubble receives focus only after explicit Regenerate.