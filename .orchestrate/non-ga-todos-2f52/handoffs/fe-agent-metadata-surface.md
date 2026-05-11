<!-- orchestrate handoff
task: fe-agent-metadata-surface
branch: orch/non-ga-todos-2f52/fe-agent-metadata-surface
agentId: bc-b4f59679-ab0b-44e1-8002-df98836c9646
runId: run-3c3a96df-d48c-42a8-b778-cc976d84a01a
resultStatus: finished
finishedAt: 2026-05-10T11:03:22.987Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/fe-agent-metadata-surface`

## What I did
- Added `getSessionCachedAgentMetadata` and `clearAgentMetadataSessionCache` in `src/utils/ai/agentClient.ts` (in-memory cache keyed by trimmed `baseUrl` + agent name for the browser session).
- Added `useChatAgentMetadata` in `src/utils/hooks/useChatAgentMetadata.ts`, which only runs the fetch when `!aiUseLocalEngine`, `aiBaseUrl` non-empty, and `aiEnabled`; wires `chat-agent` via `getSessionCachedAgentMetadata`.
- Extended `CopilotAboutPopover` to show a **Server-advertised limits** block (loading / error / `rate_limit` line + `allowed_autonomy` tags) when remote is configured, and to pass wire metadata into `resolveAiKnowledgeCutoffForUi` for `knowledge_cutoff` when metadata loads.
- Added i18n strings in `src/i18n/locales/en.ts` and `zh-CN.ts`.
- Tests: `agentClient` session-cache case, `useChatAgentMetadata.test.tsx`, and `CopilotAboutPopover` remote mock test.
- Updated `docs/todo/release-todo.md` §14 with a **Partial** note and `docs/todo/product-done.md` at-a-glance row per AGENTS.md.

## Measurements
- `npm test` (Jest): 1063 passing == 1063 passing
- `npm run typecheck` (tsc --noEmit): pass == pass
- `npm run build` (vite build): pass == pass

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- Remote-only gating matches acceptance: no metadata request when `aiUseLocalEngine` or empty `aiBaseUrl` (hook stays `idle`; About popover does not show the server-limits section unless `isRemote && aiEnabled && aiBaseUrl.length > 0`).
- No screen recording: additive disclosure UI, not a reported interactive bug; no before/after defect to record.
- Added `product-done.md` row alongside `release-todo.md` §14 update to satisfy repo AGENTS.md status hygiene for shipped increments.

## Suggested follow-ups
- Optionally surface the same metadata in the chat drawer header or Copilot settings tab for users who never open About; optionally gate `AiChatDrawer` autonomy picker options using `allowed_autonomy` (architecture-todo Theme 3).