# Bug sweep audit (`bug-sweep-4e70`)

Root-planner discovery (2026-05-19). Jest (201 suites), `tsc`, ESLint, backend pytest (1235), and `vite build` all pass on `main` — bugs below are logic/contract/a11y issues tests miss or under-spec.

**Model:** all workers/verifiers use `composer-2.5` (fast mode forbidden).

---

## Priority table

| ID | Severity | Surface | Symptom | Root cause | Primary files | Worker task |
|----|----------|---------|---------|------------|---------------|-------------|
| B1 | High | Board DnD | Drop into empty column snaps back | FE sends `referenceId: ""`; BE treats `""` as invalid ref (`reference_id is not None`) | `useDragEnd.ts:79-81`, `task_service.py:175-184` | `fix-drag-reorder-empty-ref` |
| B2 | High | Board brief (remote) | Brief stale after board edits while drawer open | Fingerprint effect calls `runBrief()` only when `!isRemote` | `boardBriefDrawer/index.tsx:456-482` | `fix-board-brief-remote` |
| B3 | Medium | AI search (remote) | Reformulations bind to edited draft, not submitted query | Remote path `applyResult(result, draft)` uses live state | `aiSearchInput/index.tsx:263-339` | `fix-ai-search-remote-query` |
| B4 | Medium | Board brief (remote) | Duplicate agent runs / flicker | Remote effect deps on whole `project` object | `boardBriefDrawer/index.tsx:456-471` | `fix-board-brief-remote` |
| B5 | Medium | Task assist (remote) | Estimate restarts on unrelated task-cache updates | Effect lists `tasks` from `useCachedQueryData` | `aiTaskAssistPanel/index.tsx:347-362` | `fix-task-assist-estimate-deps` |
| B6 | Medium | AI draft modal | Whitespace-only task names allowed | Missing `whitespace: true` on `taskName` | `aiTaskDraftModal/index.tsx:636-639` | `fix-ai-draft-modal-guards` |
| B7 | Medium | AI draft modal (remote) | Invalid column/coordinator IDs from agent | Skips `validateDraft()` vs local path | `aiTaskDraftModal/index.tsx:179-194` | `fix-ai-draft-modal-guards` |
| B8 | Medium | i18n | English `Select a …` placeholders in zh-CN | Hardcoded template strings | `taskModal/index.tsx:466,483`, `projectModal/index.tsx:219` | `fix-i18n-select-placeholders` |
| B9 | Medium | Chat drawer a11y | Focus jumps to last assistant bubble after each reply | `isLoading` false effect focuses `lastAssistantRef` | `aiChatDrawer/index.tsx:328-336, 863-867` | `fix-chat-drawer-focus` |
| B10 | Low | Project list | Sort breaks on `createdAt: ""` | `new Date("")` → Invalid Date | `projectList/index.tsx:122-127` | `fix-project-list-date-sort` |
| B11 | High | BE agents | Resume turns skip budget/project gates | `project_id` missing on resume clears enforcement | `agents.py:626-640, 403-429` | `fix-be-resume-budget` |
| B12 | High | BE v1 AI | Concurrent structured routes exceed monthly cap | `_gate` read-only `can_spend`, no `reserve` | `ai.py:250-256, 373-381` | `fix-be-v1-budget-gate` |
| B13 | Medium | BE errors | Missing stable `error.code` in JSON | `AgentError` emits string-only `error` | `errors.py:59-69`, `main.py:598-603` | `fix-be-error-envelopes` |
| B14 | Medium | BE undo | Journal marked undone on partial task failures | Still sets `undoneAt` after warnings | `agent_mutation_journal.py:86-119` | `fix-be-mutation-undo` |
| B15 | Medium | BE runtime | Tampered signed `thread_id` accepted as raw id | Verification failure falls through | `runtime.py:505-519` | `fix-be-thread-id-strict` |

---

## Verification recipes (shared)

- FE slice: `CI=true npm test -- --watchAll=false --runInBand <paths>` + `npx tsc --noEmit` + `npm run eslint -- --max-warnings 0` on touched files.
- BE slice: `cd backend && pytest <paths> -q` with coverage unchanged.
- Respect `AGENTS.md`: TaskModal `tasks === undefined` is loading; DnD `disableInteractiveElementBlocking` on interactive children.

---

## Out of scope

- GA §1 `MutationProposal` lifecycle (`release-todo.md` §1).
- Docs/todo backlog items already marked complete.
- MCP `listMembers` global directory (#14 from BE audit) — product decision, not a clear bug fix.
