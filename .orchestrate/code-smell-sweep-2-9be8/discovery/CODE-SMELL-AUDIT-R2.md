# Code smell audit — round 2 (post-merge main)

Planner discovery on `main` after round 1 merge (2026-05-18).

## Round 1 closed

- useReactMutation typing, dragAndDrop clone types, projectModal errors, aiTaskAssistPanel context dedup, useAgentThreadPersist, BE vector augment dedup.

## Round 2 targets

| ID | Severity | Files | Fix |
| --- | --- | --- | --- |
| microcopy-as-string | medium | `microcopy.ts`, `aiChatDrawer`, `useAgent.ts` | Add `microcopyString()` helper; remove `as string` casts on leaf reads |
| agent-chat-resume-silent | medium | `useAgentChat.ts` | Route `resume` failures to visible error state, not silent ref reset |
| use-agent-thread-id-extract | low | `useAgent.ts` | Move `generateThreadId` + `TTFT_SLO_MS` to `useAgentThreadId.ts` |
| ai-chat-tool-display-extract | medium | `aiChatDrawer/index.tsx` | Extract tool humanization + message bubble styled primitives to co-located modules |
| ai-chat-composer-extract | medium | `aiChatDrawer/index.tsx` | Extract prompt footer (textarea, send/stop, char hint) to `AiChatComposer.tsx` |
| sw-register-empty-catch | low | `index.tsx` | Dev-only warn on SW registration failure (keep non-blocking) |
| be-fe-tool-constants | low | `fe_tool_schemas.py`, catalog | `FE_TOOL_*` constants for interrupt tool names |
| be-board-brief-counts | low | `board_brief.py` | Extract column-count aggregation from `_compute_board_brief` |

## Out of scope (round 3+)

- Full `board.tsx` decomposition (~1020 LOC)
- `stream_agent` router split (~200 LOC inner generator)
- `task_vector_pg.py` exception narrowing (needs pytest env)

## Verification

See `bootstrap/PATHS_AND_VERIFICATION.md`.
