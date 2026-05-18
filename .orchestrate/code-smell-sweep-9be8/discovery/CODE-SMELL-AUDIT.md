# Code smell audit — code-smell-sweep-9be8

Planner discovery (2026-05-18). Workers must read this before editing product code.

## Executive summary

1. **High:** `projectModal` swallows mutation failures with `.catch(() => {})` — users get no feedback and the modal may stay open ambiguously.
2. **Medium:** `useReactMutation` and `dragAndDrop` rely on `any` for optimistic/DnD `cloneElement` typing — fixable without behavior change.
3. **Medium:** `aiTaskAssistPanel` duplicates local-engine context payloads, swallows `.catch(() => undefined)` on estimate/readiness, and clusters `(microcopy… as string)` casts.
4. **Medium:** `useAgent.ts` (~860 LOC) still embeds thread persistence helpers extractable to a sibling module.
5. **Medium (BE):** `task_estimation.py` and `search.py` duplicate pgvector augmentation blocks (~30 lines each).
6. **Deferred (out of scope this sweep):** `aiChatDrawer` (~2275 LOC) and `board.tsx` (~1020 LOC) need multi-PR extractions; not assigned here to avoid merge risk.

## Inventory

| ID | Severity | Surface | Files | Fix pattern |
| --- | --- | --- | --- | --- |
| mutation-callback-any | medium | FE hooks | `src/utils/hooks/useReactMutation.ts` | Replace `(...args: any) => any` with `(target, old?) => unknown` |
| dnd-clone-element-any | medium | FE DnD | `src/components/dragAndDrop/index.tsx` | Typed child contract; drop `as any` on `cloneElement` |
| project-modal-swallowed-error | high | FE modal | `src/components/projectModal/index.tsx:57-59` | Surface mutation error via `message.error` or form error; no empty catch |
| ai-assist-dup-context | medium | FE AI panel | `src/components/aiTaskAssistPanel/index.tsx` | Extract `buildLocalAiContext(...)` helper |
| ai-assist-swallowed-catch | medium | FE AI panel | `src/components/aiTaskAssistPanel/index.tsx` | Route local-engine failures to existing error state |
| ai-assist-magic-delays | low | FE AI panel | `src/components/aiTaskAssistPanel/index.tsx` | Named constants for debounce/delay ms |
| use-agent-thread-persist | medium | FE hooks | `src/utils/hooks/useAgent.ts` | Move storage helpers to `useAgentThreadPersist.ts` |
| be-cat-dup-vec | medium | BE catalog | `backend/app/agents/catalog/task_estimation.py`, `search.py`, `_shared.py` | Shared vector-augment helper |
| be-fe-tool-literals | low | BE metadata | catalog + `fe_tool_schemas.py` | Central FE tool name constants |

## Verification recipes (all workers)

```bash
npm ci
npm run eslint
npx tsc --noEmit
CI=true npm test -- --watchAll=false --runInBand <scoped paths>
```

Backend slice:

```bash
cd backend && python -m pytest <scoped tests> && ruff check .
```

## AGENTS.md reminders

- Do not coerce board `tasks` to `[]` for `TaskModal`.
- `useAgent` effect deps: destructure stable methods, not whole hook return objects.
- Both `useAi` and `useAgent` mount unconditionally where migration requires it.
