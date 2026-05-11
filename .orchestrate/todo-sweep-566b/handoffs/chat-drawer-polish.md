<!-- orchestrate handoff
task: chat-drawer-polish
branch: orch/todo-sweep-566b/chat-drawer-polish
agentId: bc-0bc0d697-cd45-4374-a367-6281c98bf8a5
runId: run-8592ba9a-daa0-4f85-8a14-42193f76b2d5
resultStatus: finished
finishedAt: 2026-05-11T04:54:36.973Z
-->

## Status
success

## Branch
`orch/todo-sweep-566b/chat-drawer-polish`

## What I did
- Replaced native `<details>`/inline `<pre>` for `tool` messages with a summary line plus **Show details** / **Hide details** link buttons; full payload renders only when expanded (`data-testid="chat-tool-payload-block"`).
- Added per-message clock labels using `Intl.DateTimeFormat` (`hour` / `minute`) for user, assistant, and tool rows (`data-testid` on assistant/user/tool times where useful).
- Updated assistant copy control: `aria-label` from `microcopy.ai.copyMessage`, **CheckOutlined** for ~2s after successful `navigator.clipboard.writeText` (removed success toast on copy to match the “icon feedback” path).
- Always show `characterCountTemplate` (`{count}/{max}`) under the composer; `Typography.Text type="warning"` when `count > max * 0.9`; `characterCounterMax` default **4000** in `en` / `zh-CN`; removed `characterCounterShowAfter` gating.
- i18n: `copyMessage`, `copyMessageCopied`, `toolDetailsToggle`, `toolDetailsHide`, `characterCountTemplate` (+ zh-CN). Preserved autonomy selector and other existing aria-labels not intentionally replaced (copy label moved to `microcopy.ai.*` per brief).
- Tests: `index.test.tsx` + `branches.test.tsx` (tool collapse/expand, copy label, char hint warning class); clipboard stub in `beforeEach`; `src/pages/project.ai.test.tsx` updated for new tool row selectors so project-page integration stays green.
- Left `useDelayedFlag(isLoading && !streamingText, 250)` unchanged. Draft PR: https://github.com/zhuocun/pulse/pull/199

## Measurements
(none)

- Raw tool `<pre>` in default chat view: painted by default → not painted (collapsed until toggle)
- `characterCounterMax` (microcopy): 2000 → 4000
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiChatDrawer src/__tests__/aiAccessibility`: 56 passing → 56 passing
- `npx tsc --noEmit`: pass → pass

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- **Screenshot/recording:** No before/after capture in this environment; planner can attach from manual `npm run dev` if needed.
- **Scope deviation:** Updated `src/pages/project.ai.test.tsx` (not in the original allow-list) because it asserted `details` and would fail CI; selectors now use `chat-tool-payload-block` and the **Show details** button.
- **`microcopy.ai.copyMessage` vs `microcopy.a11y.copyResponse`:** Copy button `aria-label` now uses the new `ai.copyMessage` string per task; `copyMessageCopied` is in locales for parity (toast not used because the brief preferred icon flash).
- **`docs/status`:** Not edited per instructions (orchestrator owns backlog rows).

## Suggested follow-ups
- Optional: add `message.success(microcopy.ai.copyMessageCopied)` if product wants redundant toast in addition to the checkmark icon.
- Optional UI verification pass in browser (`tool` row, timestamps, copy, char hint at >3600 chars for default cap).