<!-- orchestrate handoff
task: copilot-about-popover
branch: orch/composer-todos-979e/copilot-about-popover
agentId: bc-3809c903-7936-4841-887a-f5759aa296cc
runId: run-118d84e2-2b6a-4d98-8d4e-ac97076de85c
resultStatus: finished
finishedAt: 2026-05-10T10:19:10.024Z
-->

## Status
success

## Branch
`orch/composer-todos-979e/copilot-about-popover`

## What I did
- Routed remote/local mode `<Tag>` text through `microcopy.about.remoteModeTag` / `localModeTag` (already defined in `en` and `zh-CN`).
- Replaced static `knowledgeCutoff` copy with `knowledgeCutoffTemplate` + `{date}`; value from `resolveAiKnowledgeCutoffForUi()` in `src/utils/ai/agentClient.ts` (wire `knowledge_cutoff` first, else `environment.aiKnowledgeCutoff` from `REACT_APP_AI_KNOWLEDGE_CUTOFF`, documented in `src/constants/env.ts`, default `January 2026`).
- Extended `AgentMetadata` with optional `knowledge_cutoff`; added resolver unit tests; updated popover test expectation.
- Updated `docs/status/ui-todo.md` (§20c + intro) and `docs/status/product-done.md` per AGENTS.md.
- Opened draft PR https://github.com/zhuocun/pulse/pull/192 (`main` ← this branch). `.orchestrate/` was not staged or committed.

## Measurements
- Raw English Remote/Local labels in `CopilotAboutPopover` JSX: present → absent (uses microcopy)
- Knowledge cutoff documented source: one-off i18n string → `REACT_APP_AI_KNOWLEDGE_CUTOFF` in `src/constants/env.ts` (+ optional `AgentMetadata.knowledge_cutoff` precedence in resolver)
- Jest (`copilotAboutPopover` + `agentClient.test`): 32 passing == 32 passing
- Typecheck (`tsc --noEmit`): pass == pass

## Verification
`unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- `.orchestrate/composer-todos-979e/bootstrap-context.md` was not in the workspace; implementation followed `ui-todo.md` §20c and the scoped file list.
- No UI screen recording: change is copy/config wiring, not an interactive bug repro/fix.
- Backend `AgentMetadata.as_dict()` does not emit `knowledge_cutoff` yet; the FE field is ready for when the API adds it.

## Suggested follow-ups
- Emit `knowledge_cutoff` from backend agent metadata and optionally fetch it for the about popover when you want ops-free deploys without a frontend env bump.