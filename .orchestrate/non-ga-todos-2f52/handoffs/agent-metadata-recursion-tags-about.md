<!-- orchestrate handoff
task: agent-metadata-recursion-tags-about
branch: orch/non-ga-todos-2f52/agent-metadata-recursion-tags-about
agentId: bc-2fdebdfb-eddd-4b56-ba04-6a65ea2f2dea
runId: run-9ba4d923-707d-4244-8a22-9e914eebd68a
resultStatus: finished
finishedAt: 2026-05-10T13:11:51.711Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/agent-metadata-recursion-tags-about`

## What I did
- Extended `AgentMetadata` in `src/interfaces/agent.d.ts` to include:
  - `recursion_limit?: number`
  - `tags?: string[]`
  - `context_schema?: Record<string, unknown>`
- Updated `src/components/copilotAboutPopover/index.tsx` server-metadata disclosure block (still session-cached via `useChatAgentMetadata`) to render, when present:
  - rate-limit line (existing)
  - allowed-autonomy chips (existing)
  - **recursion-limit line** (new)
  - **tags chip list** (new)
  - optional **context-schema key-shape line** (new)
  - graceful ready-state empty message when no metadata fields are disclosed
- Preserved remote-only gating behavior: metadata section is shown only when `!aiUseLocalEngine` and `aiBaseUrl` is non-empty.
- Extended `src/components/copilotAboutPopover/index.test.tsx` to assert:
  - new `recursion_limit` + `tags` disclosures render (plus context schema line)
  - local-engine path renders no server metadata section and does not fetch metadata
  - empty-base-url path renders no server metadata section and does not fetch metadata
  - graceful empty disclosure message renders when metadata is present but lacks limit fields
- Updated release backlog status in `docs/todo/release-todo.md` §14 partial note to include newly surfaced fields (`recursion_limit`, `tags`, optional `context_schema` key shape).

## Measurements
(none)

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Automated verification completed:
  - `CI=true npm test -- --watchAll=false --runInBand src/components/copilotAboutPopover/index.test.tsx` (pass)
  - `npm run eslint` (pass; existing unrelated warning in `src/components/aiChatDrawer/index.tsx`)
  - `npx tsc --noEmit` (pass)
  - `CI=true npm test -- --watchAll=false --runInBand` (147 suites, 1067 tests passing)
  - `npx vite build` (pass)
- Manual UI verification done against a local mock metadata endpoint in remote mode; recorded artifact:
  - `/opt/cursor/artifacts/copilot_about_popover_metadata_fields.mp4`
- Per instruction, no PR was opened.

## Suggested follow-ups
- Localize the newly added “Recursion limit”, “Tags”, and “Context schema keys” labels through `microcopy`/i18n files in a follow-up if you want full translation parity with existing popover strings.