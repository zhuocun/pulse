# PRD gap TODO — consolidated, actionable

Consolidated, de-duplicated backlog distilled from the implementation-status
review of the six Pulse PRDs. Each row is an **actionable** task, not a
roadmap line. Coarse roadmap bullets live in
[`feature-build-progress.md`](feature-build-progress.md); the live AI release
status lives in [`release-todo.md`](release-todo.md); shipped inventory lives
in [`product-done.md`](product-done.md); UI/UX polish lives in
[`ui-todo.md`](ui-todo.md). This file is the **gap** layer: the work the PRDs
specify that none of those trackers has fully closed.

## How to read this

Each task carries: `id`, `title`, `prd_ref` (file + section/AC), `status`
(`open` | `blocked` | `deferred`), `owner_hint` (`FE` | `BE` | `ops` |
`docs`), `acceptance` (testable), `depends_on`, and `notes` (why it exists +
evidence paths).

Tiers, highest priority first:

- **P0 — ship blockers / doc truth.** Documentation that contradicts the
  shipped code, plus a latent data-loss bug.
- **P1 — high-value product gaps.** Backends that shipped but have no
  user-reachable FE surface, plus the consolidated-Copilot rollout.
- **P2 — depth PRD.** Net-new completeness features (work-management depth,
  accounts/orgs, collaboration-notifications depth).
- **P3 — deferred / platform / ops readiness.** Horizon AI (shadow/Auto),
  out-of-app delivery infra, and operator-only readiness.

## Scope guardrails (applied while drafting)

- **No duplicates of completed work.** Items already shipped per
  `feature-build-progress.md` (RBAC, task richness backend, comments UI on
  `TaskModal`, notifications inbox, priority, dependencies + blocked badge,
  lifecycle/trash/archive drawers, milestone FE, `preserveNullKeys` for
  `milestoneId`, org tenancy spine) are **not** re-listed; tasks that extend
  them reference the existing milestone in `notes`.
- **Doc tasks reflect the *current* gap.** `api/backend.md` and
  `api/frontend.md` were already reconciled for the *core* collaboration layer
  (RBAC, members, richness, `wipLimit`, labels, comments, notifications,
  bulk); the remaining doc gap is the shipped **WMD-depth + org** additions —
  see PRD-GAP-001/002/003.
- **Excluded per PRDs (not tasks):** MCP, voice, SSO/OIDC, SCIM, PATs/public
  API, billing/seats, CRDT/Yjs co-editing, cross-project planning, four-level
  autonomy dial, configurable end-user prompts, reporting/velocity (M6),
  attachments + real-time SSE (M7), org-wide audit + "plan this sprint" (M8),
  Slack/Confluence/digest dispatch.

---

## P0 — Ship blockers / doc truth

### PRD-GAP-001 — Document shipped WMD-depth + org endpoints in `api/backend.md`
- **prd_ref:** `docs/prd/work-management-depth.md` §3–§5, §9, Appendix A; `docs/prd/accounts-organizations.md` §3, Appendix A
- **status:** done
- **owner_hint:** docs
- **acceptance:**
  - `api/backend.md` documents the shipped `tasks.priority`, `tasks.dependsOn` (+ derived `blockedBy`), `columns.category`, and the lifecycle fields (`completedAt`/`archivedAt`/`deletedAt`) with their soft-delete `?purge`, `/tasks/restore`, `/tasks/archive`, `/projects/restore`, `/projects/archive` endpoints.
  - It documents the `milestones` collection + `/api/v1/milestones` CRUD and the `organizationId` tenancy spine (`can_access_org`, org-gated create, tenant-scoped listing).
  - Every documented endpoint matches the shipped router behaviour (spot-checked against `backend/app/routers/`).
- **depends_on:** none
- **notes:** `api/backend.md` already covers the core layer (RBAC at line 553, members/labels/comments/notifications/bulk), but a content scan shows **zero** mention of `priority`/`dependsOn`/`category`/`completedAt`/`deletedAt`/`organizationId`/`/restore`/`/archive` — all shipped per `feature-build-progress.md` (`9e4691de`, `fa1ce79a`, `68553cbb`, `143866e4`, `4eb250bd`, `f30efe87`). The doc trails the code.

### PRD-GAP-002 — Reconcile `api/frontend.md` interface table + hook notes with shipped depth & surfaces
- **prd_ref:** `docs/prd/core-collaboration.md` §10, §13; `docs/prd/work-management-depth.md` Appendix B
- **status:** done
- **owner_hint:** docs
- **acceptance:**
  - The `ITask`/`IColumn` rows add the shipped depth fields (`priority`, `dependsOn`, `milestoneId`, `completedAt`/`archivedAt`/`deletedAt`); `IMilestone` is listed.
  - The stale "no member-management UI ships today" / "`role` is not rendered anywhere" notes are corrected — `ProjectMembersManager` (`/projects/:projectId/members`) ships and renders roles (`feature-build-progress.md` M4d).
  - Hook notes list the shipped surfaces the doc omits: `useComments`/`CommentsThread`, trash/archive drawers, the `dependsOn` editor, and the milestone surface.
- **depends_on:** none
- **notes:** `api/frontend.md:109/125/361` still claims member verbs have no FE caller and `role` is never rendered — both false since M4d. The `ITask`/`IColumn` table (`:1769`) covers core richness + `wipLimit` but omits all WMD-depth fields.

### PRD-GAP-003 — Correct the now-stale "Documentation Debt" table in `core-collaboration.md` §13
- **prd_ref:** `docs/prd/core-collaboration.md` §13
- **status:** done
- **owner_hint:** docs
- **acceptance:**
  - §13's claims that `api/backend.md` documents a flat task / says "access restricted to the project manager", and that `api/frontend.md`'s interface table is pre-richness, are removed or rewritten to match reality (both docs reconciled for the core layer).
  - §13 instead points at the *remaining* gap (the WMD-depth + org additions tracked in PRD-GAP-001/002), so the PRD no longer contradicts the docs it cites.
- **depends_on:** PRD-GAP-001, PRD-GAP-002
- **notes:** `api/backend.md:555` now reads "role-based access control, not a single manager" and `api/frontend.md:1769` carries the richness fields — directly contradicting §13's stale debt rows. A `✅ Resolved`-style stale doc cross-reference is exactly the doc-code incoherence AGENTS.md warns against.

### PRD-GAP-004 — Refresh `product-done.md` for CopilotDock + Phase-4 AI surfaces
- **prd_ref:** `docs/prd/v3-ai-ux.md` §7.1–§7.3; `docs/design/_review-2026-05/04-ai-copilot.md` A1
- **status:** done
- **owner_hint:** docs
- **acceptance:**
  - The "Unified Copilot shell scaffold — Reverted… built from scratch when design lands" rows are replaced with the as-built CopilotDock (`src/components/copilotDock/`, Chat/Brief/Inbox tabs, `useCopilotDock`, `REACT_APP_COPILOT_DOCK_ENABLED`).
  - Phase-4 AI surfaces now in the tree are recorded: ghost text (`REACT_APP_AI_GHOST_TEXT_ENABLED`), column readiness (`REACT_APP_AI_COLUMN_READINESS_ENABLED`), activity feed, and `copilotMenu`.
  - The doc's flag inventory matches `src/constants/env.ts`.
- **depends_on:** none
- **notes:** `product-done.md:34,68,203` still say the right-rail "will be built from scratch"; the dock and four Phase-4 flags shipped (`src/constants/env.ts:195–249`, `src/utils/hooks/useCopilotDock.ts`). Doc-only; split from the code rollout (PRD-GAP-006).

### PRD-GAP-005 — Extend `preserveNullKeys` to `parentTaskId` and the date fields
- **prd_ref:** `docs/prd/core-collaboration.md` §6.3; `feature-build-progress.md` (Open decisions — FE clear-semantics)
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - Clearing `parentTaskId`, `startDate`, or `dueDate` in `TaskModal` sends the key as an explicit `null`/`""` (not stripped) so the PUT unassigns instead of silently keeping the old value.
  - Default void-stripping behaviour is byte-identical for every other caller (additive opt-in, mirroring the `milestoneId` fix `96030127`).
  - Regression test proves a cleared parent/date survives a refetch.
- **depends_on:** none
- **notes:** `feature-build-progress.md` records the same latent gap fixed for `milestoneId` (`filterRequest` strips `null`/`""` → cleared scalar reaches the wire as absent → treated as unchanged). The 1-line opt-in per field is called out as "a cheap follow-up" (recon `a0a1f195`). Silent data revert = ship-quality bug.

---

## P1 — High-value product gaps

### PRD-GAP-006 — Roll out CopilotDock (flip flag default ON; remove legacy drawers)
- **prd_ref:** `docs/prd/v3-ai-ux.md` §7.1; `docs/design/_review-2026-05/04-ai-copilot.md` A1
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - `environment.copilotDockEnabled` defaults ON (kill-switch; `REACT_APP_COPILOT_DOCK_ENABLED=false` rolls back) and the board mounts the single tabbed dock as the live surface.
  - The legacy `AiChatDrawer` / `BoardBriefDrawer` standalone surfaces are removed (their bodies already live in `copilotDock/ChatTabBody` + `BriefTabBody`); no duplicate `EngineModeTag` / `Space.Compact` launchers remain.
  - Existing dock + agent tests pass (`board.dock.test.tsx`, `copilotDock/*.test.tsx`); no regression in the full Jest suite.
- **depends_on:** none
- **notes:** Shipped — `src/constants/env.ts` flips `copilotDockEnabled` to a default-ON kill-switch, and the `<AiChatDrawer>` / `<BoardBriefDrawer>` wrapper components + their standalone mounts in `pages/board.tsx` / `pages/project.tsx` are deleted (the dock owns the triage agent, inbox nudges, and the `boardCopilot:openChat` palette hand-off via `CopilotDockHost`). The shared composer/brief bodies live in `copilotDock/ChatTabBody` + `BriefTabBody`. Pairs with PRD-GAP-004 (doc) but split per AGENTS.md.

### PRD-GAP-007 — WIP-limit control UI on column create/edit + overflow indicator
- **prd_ref:** `docs/prd/core-collaboration.md` §5.5, §12 (⬜ WIP-limit control); AC-C11
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - `ColumnCreator` and the column-edit path send `wipLimit` (non-negative int; `0` = no limit) on `POST`/`PUT /boards`.
  - The column header surfaces the limit and a non-colour-only overflow indicator when `count > wipLimit > 0` (matches the overdue-chip a11y rule).
  - Touch target ≥44px under `pointer: coarse`; axe-clean.
- **depends_on:** none
- **notes:** Shipped — `ColumnCreator` gains a `wipLimit` `InputNumber` (default `0`) and the column more-actions menu opens an edit modal sending `{columnName, category, wipLimit}` on `PUT /boards` (optimistic via `optimisticUpdate/updateColumn`). The header renders a `{count} / {limit}` badge plus a glyph + "Over limit" chip (non-colour-only) when the unfiltered count exceeds a positive limit; both ride a 44px coarse-pointer target.

### PRD-GAP-008 — Bulk-edit UI (board multi-select → fan-out `PUT /tasks/bulk`)
- **prd_ref:** `docs/prd/core-collaboration.md` §6.2.1, §12 (⬜ Bulk edit UI); `docs/prd/work-management-depth.md` §10.5
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - A multi-select affordance lets a user pick N tasks and apply a metadata change (labels, assignees, priority, etc.) via `PUT /tasks/bulk`.
  - Routing fields (`columnId`/`projectId`) are not offered (server drops them); a single bad id surfaces the all-or-nothing 404 cleanly.
  - Optimistic update + error rollback covered by a test.
- **depends_on:** none
- **notes:** Shipped — task cards gain a hover/focus-revealed select checkbox (gated on `BulkSelectionProvider`; never on optimistic placeholders) feeding a `useBulkSelection` context. A floating `BulkEditToolbar` fans priority / coordinator / labels across the selection via `PUT /tasks/bulk` (routing fields never offered), optimistic through `optimisticUpdate/bulkUpdateTasks` with error rollback + selection-preserved retry. The table view (PRD-GAP-014) is its richer long-term home.

### PRD-GAP-009 — Port the five richness fields into `TaskDetailPanel`
- **prd_ref:** `docs/prd/core-collaboration.md` §6.5, AC-C26, §12 (⬜ Task richness on routed panel)
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - `TaskDetailPanel` edits `startDate`, `dueDate`, `labelIds`, `assigneeIds`, and `parentTaskId` (parity with `TaskModal`), reusing `useProjectMembers`/`useLabels`.
  - Clearing a scalar FK/date uses the PRD-GAP-005 `preserveNullKeys` opt-in.
  - With `REACT_APP_TASK_PANEL_ROUTED=true`, no richness field is lost vs the legacy modal (regression test).
- **depends_on:** PRD-GAP-005
- **notes:** Shipped — `TaskDetailPanel` now edits `startDate`, `dueDate`, `labelIds`, `assigneeIds`, and `parentTaskId` (parity with `TaskModal`), reusing `useLabels` / `useProjectMembers` and the same date `DatePicker` / label `tagRender` / assignee / parent pickers. The PUT mutation opts `parentTaskId`/`startDate`/`dueDate` into `preserveNullKeys` (the GAP-005 pattern) and the dirty-check compares `filterRequest`'d payloads so an untouched optional field fires no needless PUT. Regression tests in `taskDetailPanel/index.test.tsx` prove the fields ride the PUT and a cleared parent reaches the wire as `null`.

### PRD-GAP-010 — Mount the comments thread on `TaskDetailPanel`
- **prd_ref:** `docs/prd/core-collaboration.md` §8.5, §12 (✅ on `TaskModal`, remaining: routed panel)
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - `TaskDetailPanel` mounts `CommentsThread` (`useComments`) with the same author-only edit / author-or-owner delete rules and mention multi-select as `TaskModal`.
  - A mention-bearing create invalidates the notifications query (bell badge refreshes).
  - Covered by a panel-level test.
- **depends_on:** PRD-GAP-009
- **notes:** Shipped — `TaskDetailPanel` mounts `CommentsThread` (`useComments`) below the form for a real (non-placeholder) task, reusing the same author-only edit / author-or-owner delete rules and mention multi-select as `TaskModal`; a mention-bearing create invalidates the notifications query via `useComments`. Panel-level tests in `taskDetailPanel/index.test.tsx` cover the thread mount and the mention → notifications-invalidation path. Reuses the existing hook/component — no new backend.

### PRD-GAP-011 — Label management UI (create / edit / delete)
- **prd_ref:** `docs/prd/core-collaboration.md` §7.4, §12 (⬜ Label management UI), AC-C20
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - A labels surface (page or settings modal) lists project labels and supports create/edit (name + colour)/delete via `useLabels`.
  - Delete confirms and relies on the server cascade-strip; chips disappear from cards after delete.
  - Editor-gated controls; axe-clean; ≥44px targets.
- **depends_on:** none
- **notes:** Shipped — `useLabels` gains `updateLabel` / `removeLabel` (PUT/DELETE) alongside the existing `createLabel`. A new `LabelsManager` (`src/components/labelsManager/`) lists the project's labels as colour chips and offers editor-gated create / rename+recolour / delete (a `Popconfirm` whose body names the project-wide server cascade-strip). It mirrors the milestones / members managers' role-gate (`useProjectMembers` roster + project `managerId`); a viewer/guest sees the list read-only. The surface mounts at `/projects/:projectId/labels` via a thin `pages/labels.tsx` shell wired into the project-detail child nav + breadcrumb. Colour is a curated swatch palette (`radiogroup`, 44px coarse targets); microcopy lives under `projectLabels.*` in `en`/`zh-CN`; axe-clean.

### PRD-GAP-012 — "Rewrite with AI" side panel on the task note editor
- **prd_ref:** `docs/prd/v3-ai-ux.md` §7.5; `docs/prd/v2.1-agent.md` AC-V12
- **status:** done
- **owner_hint:** FE
- **acceptance:**
  - A "Rewrite with AI" button above the note textarea opens a **side panel** (textarea stays visible) with the spec options (user story, acceptance criteria, translate, summarize, polish, free prompt).
  - Accept replaces the note + shows the "Suggested by Copilot" badge; Cancel reverts; keyboard-operable (Tab/Enter/Esc); diff view for notes >3 lines.
  - Streams via the existing agent plumbing; aborts on close; axe-clean.
- **depends_on:** none
- **notes:** Shipped — `src/components/aiRewritePanel/` renders a "Rewrite with AI" trigger above the note textarea (in both `TaskModal` and `TaskDetailPanel`) that expands an inline side panel while the textarea stays visible. The dual-engine `useRewrite` hook (`src/utils/hooks/useRewrite.ts`) streams through the `chat-agent` plumbing on a fresh per-run thread id (so a rewrite never bleeds into the chat dock) and falls back to deterministic local rules in `src/utils/ai/rewrite.ts` (`rewriteNoteLocally`, `diffLines`); translate/free require the remote engine and show an explanatory notice offline. Accept replaces the note via `form.setFieldsValue` and stamps the "Suggested by Copilot" badge through `appliedFieldOrigin`; Cancel/close aborts any in-flight stream (the body unmounts → `useAgent` cleanup aborts). Notes longer than three lines render a line diff. Microcopy lives under `aiRewrite.*` in `en`/`zh-CN`; `COPILOT_REWRITE_ACCEPT` fires on accept; component + hook + engine tests cover the flow and axe-clean.

---

## P2 — Depth PRD

### PRD-GAP-013 — Queryable / paginated `GET /api/v1/tasks`
- **prd_ref:** `docs/prd/work-management-depth.md` §10.4, AC-W20, AC-W21
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `GET /tasks` accepts optional `sortBy`/`sortDir`, equality/`in` filters (`columnId`/`coordinatorId`/`labelId`/`milestoneId`/`epic`/`assigneeId`/`priority`), date-range filters, `includeArchived`/`includeTrashed`, and `limit`/`cursor`.
  - Absent params reproduce today's `index`-sorted full list exactly (backward-compatible).
  - The listed `tasks` indexes are added in `ensure_indexes`.
- **depends_on:** none
- **notes:** Today `GET /tasks` is "a single unfiltered, unpaginated full scan" (§10.1). Foundational for PRD-GAP-014; tracked coarsely in `feature-build-progress.md` ("queryable/paginated GET /tasks …").

### PRD-GAP-014 — Alternate views (List / Table / Calendar / Timeline) + board swimlanes
- **prd_ref:** `docs/prd/work-management-depth.md` §10.2, §10.5, AC-W22
- **status:** open
- **owner_hint:** FE
- **acceptance:**
  - A view switcher renders list, table (selectable columns + inline edit), calendar (`startDate`/`dueDate`), and timeline (bars + `dependsOn` edges) over the same task data.
  - Board swimlane grouping by assignee/epic/priority/milestone.
  - View config lives in URL/query state (persistence deferred to M5); axe-clean across viewports.
- **depends_on:** PRD-GAP-013
- **notes:** Only the kanban board exists (§10.1). Table view is the natural home for the bulk-edit UI (PRD-GAP-008). Saved-view persistence is M5 — out of scope here per §10.3.

### PRD-GAP-015 — Custom fields (`customFieldDefs` + `tasks.customFields`)
- **prd_ref:** `docs/prd/work-management-depth.md` §8, AC-W15, AC-W16, AC-W17
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `customFieldDefs` per-project CRUD (`owner`-gated; `select` requires `options`; `type`/`key` immutable on `PUT`); delete cascade-strips the key from tasks.
  - `customFields` added as **one** allowlisted nested map on `tasks`; `validate_fields` still rejects unknown top-level keys while a service `_custom_fields_error` validates the map shape against the project's defs.
  - Per-type value checks (number/date/select/checkbox/text) enforced.
- **depends_on:** none
- **notes:** The single `TABLE_FIELDS` relaxation of WMD (§8.2) — land it behind tests before exposing the field. Definition-driven inputs surface in the task editor and as table columns (PRD-GAP-014).

### PRD-GAP-016 — Project & task templates (+ checklist)
- **prd_ref:** `docs/prd/work-management-depth.md` §7, AC-W14
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `templates` collection + CRUD; `POST /templates/instantiate` seeds a task (`editor`) or a new project (authenticated, caller=manager) from the payload instead of the fixed `column_seed` defaults.
  - A task-template `payload` may carry a `checklist` (`[{text, done}]`); instantiation runs through the normal services (RBAC + `validate_fields`).
  - "Save as template" + a template gallery in the create flows (FE).
- **depends_on:** none
- **notes:** Project create always seeds the same three columns (§7.1). Project-scoped only (org sharing is M5).

### PRD-GAP-017 — Recurring tasks + shared scheduler worker
- **prd_ref:** `docs/prd/work-management-depth.md` §6, AC-W12, AC-W13
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `tasks.recurrence` shape-validated (`freq` enum, positive `interval`/`count`, in-range `byweekday`, `until` xor `count`).
  - A background scheduler (embedded APScheduler or worker) instantiates occurrences through the same repository + allowlist, honouring `until`/`count`, stamping `recurrenceParentId`; idempotent under multiple workers; missed-tick catch-up handled.
  - The worker also hosts the §5.4 trash-purge sweep (shared scheduling substrate).
- **depends_on:** none
- **notes:** "No scheduler exists at all" (§6.1) — this is the system's first background-worker dependency (Rollout §14). Sequenced last in `feature-build-progress.md` (new runtime dep). The `due_soon` sweep (PRD-GAP-026) reuses this substrate.

### PRD-GAP-018 — Align the milestone model with WMD §9
- **prd_ref:** `docs/prd/work-management-depth.md` §9.2, AC-W18, AC-W19
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - The shipped milestone fields are reconciled to the PRD shape: `goal` (not `description`), `endDate` (not `dueDate`), `status` ∈ `planned|active|completed` (not `state`), with `endDate ≥ startDate` validation.
  - Milestone read returns the `{total, done}` completion count (done = member tasks in a `category=="done"` column).
  - FE milestone surface + any consumers updated for the renamed fields; tests cover the count.
- **depends_on:** none
- **notes:** Milestones shipped (backend + FE, `143866e4`/`83cc9d6b`) but the as-built service uses `{name, description, startDate, dueDate, state}` (`backend/app/services/milestone_service.py:13`) — diverging from §9.2's `{goal, endDate, status}` + `{total, done}`. This is a model-alignment gap, not a re-build (so not a duplicate of the shipped FE milestone work).

### PRD-GAP-019 — WMD AI assists: auto-priority / dependency / duplicate-merge
- **prd_ref:** `docs/prd/work-management-depth.md` §11.2, AC-W3, AC-W23, AC-W24
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - Three suggest-only surfaces (`surface:"priority"|"dependency"|"duplicate"`) emit `{kind:"suggestion", …}` via the existing `interrupt()` payload; none write directly.
  - Duplicate detection reuses the existing `jaccard`/`token_set` (+ optional pgvector) infra; cycle-introducing dependency candidates are filtered server-side before surfacing.
  - Accepted suggestions write through `PUT /tasks` (or soft-`DELETE` for merge) and are recorded in the mutation journal; governed by the existing autonomy model (no new runtime).
- **depends_on:** none
- **notes:** Priority + `dependsOn` fields shipped; the assists are unbuilt (§11.x Partial). Reuses `catalog/task_estimation.py:67-96`. No new agent process / autonomy dial.

### PRD-GAP-020 — Organization string→entity backfill script
- **prd_ref:** `docs/prd/accounts-organizations.md` §3.4, AC-O4
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - A one-shot, idempotent, non-destructive script distinct-scans `projects.organization`, upserts one `organizations` row per distinct string (seeding ≥1 `org_owner`), and stamps `projects.organizationId`.
  - The legacy `organization` string is left in place (dual-write window); re-running is a no-op.
  - Dry-run mode + summary output (mirrors `backfill_task_embeddings.py`).
- **depends_on:** none
- **notes:** Org spine shipped (`4eb250bd`, `f30efe87`) but the backfill is still ⬜ in `feature-build-progress.md`; only `backfill_task_embeddings.py`/`generate_parity_golden.py` exist in `backend/scripts/`. Foundational before the org `organization`-string can be dropped.

### PRD-GAP-021 — Organizations frontend (switcher, settings, members, project picker)
- **prd_ref:** `docs/prd/accounts-organizations.md` §3.7, AC-O6, AC-O7
- **status:** open
- **owner_hint:** FE
- **acceptance:**
  - An org switcher in the header scopes the project list/create flow to the active org.
  - An Organization settings page with a Members tab renders org roles and supports add/change-role/remove (last-`org_owner` guard surfaced).
  - `ProjectModal` replaces its free-text organization input with an org picker sourced from the caller's memberships.
- **depends_on:** PRD-GAP-020
- **notes:** Org backend (entity, `can_access_org`, member endpoints) shipped; the entire org FE is ⬜ (`feature-build-progress.md`: "Org/teams frontend"). First surface to render any role.

### PRD-GAP-022 — Teams (collection + endpoints + fan-out) and Teams UI
- **prd_ref:** `docs/prd/accounts-organizations.md` §4, AC-O8, AC-O9, AC-O10
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `teams` per-org collection + CRUD (`org_admin`; name unique-in-org; members must be org members); delete cascade-strips from project links + task `assigneeTeamIds`.
  - `POST /teams/assign` fans a team out to per-user project memberships via the existing `add_member` path; `@team` mention expands at fan-out time through the existing per-recipient eligibility filter.
  - A Teams tab in Org settings (create/manage/delete) and a team option group in the assignee select.
- **depends_on:** PRD-GAP-021
- **notes:** "No team/group entity anywhere in the tree" (§4.1). Org-scoped, strictly after the org layer.

### PRD-GAP-023 — Invitations + email verification + password reset
- **prd_ref:** `docs/prd/accounts-organizations.md` §5, AC-O11, AC-O12, AC-O13, AC-O14, AC-O15
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `invitations` collection (hashed token, `scope ∈ org|project`); invite-by-email works for a not-yet-registered person (accept-on-signup consumes pending invites); revoke supported.
  - Email verification (`emailVerified` + request/confirm) and password reset (request always 200 anti-enumeration; confirm re-hashes via `encrypt_password`) ship; the FE `forgotPassword` page is wired.
  - Dev-mode "log the link" sender is acceptable until a transport is chosen (OQ-6); tokens hashed at rest, single-use/short-TTL.
- **depends_on:** PRD-GAP-021
- **notes:** Member-add still requires an existing user (`project_service.py:236`); `forgotPassword` is FE-only with no backend (§5.1). Closes onboarding-outsiders gap. The email *transport* itself is shared with PRD-GAP-033 (deferred infra).

### PRD-GAP-024 — Guest role + public read-only share links
- **prd_ref:** `docs/prd/accounts-organizations.md` §6, AC-O16, AC-O17, AC-O18, AC-O19
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `guest` added at rank 0 below `viewer` (write gates auto-exclude guests).
  - `share_tokens` (hashed) + a separate **unauthenticated** token-gated `GET` read path for board/task snapshots (columns/tasks/labels only); no token-authenticated write exists; revoked/expired tokens rejected.
  - A Share affordance (project `owner`) to create/copy/revoke a link, and a minimal read-only public viewer route.
- **depends_on:** none
- **notes:** `guest` at rank 0 already landed (`70e081fb`) per `feature-build-progress.md`; the share-token path + public viewer + guest UX are still ⬜ (§6.7). Read-only / non-real-time is a hard boundary (§6.4).

### PRD-GAP-025 — Account / profile management + profile fields
- **prd_ref:** `docs/prd/accounts-organizations.md` §7, AC-O20, AC-O21, AC-O22
- **status:** open
- **owner_hint:** FE
- **acceptance:**
  - `users` gains `displayName`/`avatar`/`timezone`/`locale` in both `TABLE_FIELDS[users]` and the self-service allowlist (no privilege field added).
  - An Account/Profile surface becomes the **first** FE caller of `PUT /users` (edit username/email/password + profile fields).
  - Self-only account deletion (`DELETE /users`, soft-delete + anonymize) with last-`org_owner` / project-manager guards.
- **depends_on:** none
- **notes:** `PUT /users` exists but has "no FE caller at all" (§7.1/§7.7); `settings.tsx` has only theme/language/AI-toggle/logout. `timezone`/`locale` read back into `src/i18n` + date rendering.

### PRD-GAP-026 — Watchers/subscriptions + notification breadth + `actorId`
- **prd_ref:** `docs/prd/collaboration-notifications.md` §3, §4, AC-N1–AC-N8
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `tasks.watcherIds` + a `subscriptions` collection with watch/unwatch + subscribe endpoints (subscriber from JWT `sub`, `projectId` derived from task); auto-watch on assign/comment/mention.
  - New producer kinds (`assignment`, `mention_on_edit`, `due_soon`, `status_change`, `comment_reply`, `membership_change`) emitted from the named mutation sites; `mention_on_edit` notifies only newly-added mentions (no re-spam).
  - `notifications.actorId` added and persisted; audience = explicit ∪ watchers ∪ subscribers, minus actor/non-members, de-duped.
- **depends_on:** none
- **notes:** The notifications model + consumer FE shipped, but there is "exactly one producer" (`mention`) and no `actorId` (`collaboration-notifications.md` §4.7) — explicitly NOT "notifications not started"; this is depth on a live base inbox. `due_soon`'s sweep rides PRD-GAP-017's scheduler.

### PRD-GAP-027 — Notification preferences (per-kind / per-channel + quiet hours)
- **prd_ref:** `docs/prd/collaboration-notifications.md` §5, AC-N9, AC-N10, AC-N11
- **status:** open
- **owner_hint:** FE
- **acceptance:**
  - `users.notificationPrefs` (`byKind` channel matrix + `quietHours`) added; missing kind defaults to all channels on.
  - Self-only `GET`/`PUT /users/notification-prefs` with `_prefs_error` validation; the in-app producer suppresses a muted kind's row.
  - A Notifications section in `settings.tsx` renders the per-kind toggle matrix + quiet-hours editor (first FE caller of a `users` write family).
- **depends_on:** PRD-GAP-026
- **notes:** No prefs of any kind today (§5.1). The in-app half (mute a kind) ships without the out-of-app delivery infra (PRD-GAP-033).

### PRD-GAP-028 — Comment richness (threading, reactions, edit history)
- **prd_ref:** `docs/prd/collaboration-notifications.md` §7, AC-N15, AC-N16, AC-N17
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - `comments` gains `parentCommentId` (one-level; reply-to-reply re-parents), `reactions` (`{emoji:[userId]}`, idempotent, own-reaction-only), and `editedAt` + `revisions` (edit appends prior body).
  - `POST/DELETE /comments/reactions` and `GET /comments/revisions` ship; author-only edit + author-or-manager delete rules unchanged.
  - The `CommentsThread` UI renders one-level replies, a reaction bar, and an "edited" indicator opening the revision viewer.
- **depends_on:** none
- **notes:** Comments backend is flat (§7.7); the richness fields and UI extend the shipped base thread (M4c). `@team` mentions in the composer depend on PRD-GAP-022.

### PRD-GAP-029 — Per-task activity timeline (`activity` collection)
- **prd_ref:** `docs/prd/collaboration-notifications.md` §8, AC-N20, AC-N21, AC-N22
- **status:** open
- **owner_hint:** BE
- **acceptance:**
  - A new append-only `activity` collection (`entityType, entityId, projectId, actorId, verb, before?, after?`) is written from each service mutation (`create`/`update`/`delete`/`reorder`/`bulk_update`/membership).
  - `GET /activity` is `viewer`-gated (per-entity or project feed) with no write endpoint; rows are immutable.
  - A task-surface Activity timeline interleaves system events with comments; documented as distinct from the M8 audit log and the session-only `useActivityFeed`.
- **depends_on:** none
- **notes:** Only `updatedAt` is overwritten per write (§8.1); the sole journal is the AI-only `agent_mutation_journal`. Independent of the notification work; can land in parallel. Scoped apart from M8.

### PRD-GAP-030 — AI thread summarization (suggest-only)
- **prd_ref:** `docs/prd/collaboration-notifications.md` §9, AC-N23
- **status:** open
- **owner_hint:** FE
- **acceptance:**
  - A "Summarize thread" affordance on long comment threads renders a transient, clearly-labelled "AI summary (not saved)" block.
  - It reuses the existing `be.summarize` tool over the thread's `viewer`-gated comments; persists nothing; honours the per-project AI-enabled gate.
  - No new agent/transport/autonomy dial; aborts on close.
- **depends_on:** PRD-GAP-028
- **notes:** `be.summarize` already exists (board briefs); the net-new piece is the over-comments action, gated on threaded comments + the comments UI (§9.2/§9.4).

---

## P3 — Deferred / platform / ops readiness

### PRD-GAP-031 — Shadow mode for per-tool quality validation
- **prd_ref:** `docs/prd/v2.1-agent.md` §6.6, AC-V17, Phase F
- **status:** open
- **owner_hint:** FE
- **acceptance:**
  - Shadowed tools generate `mutation_proposal` events that the FE silently logs to telemetry instead of rendering.
  - Shadow mode is opt-in per tool, per project, admin-only in a Settings panel; shadow-vs-actual correlation is recorded.
  - No shadowed proposal ever surfaces a card to a non-admin user.
- **depends_on:** none
- **notes:** Prerequisite for Auto promotion (§6.6, the chicken-and-egg solution). No `shadow` wiring exists in `src/` today. Horizon AI — below the core product gaps in priority.

### PRD-GAP-032 — Enable "Auto" autonomy (metadata-driven, post-shadow)
- **prd_ref:** `docs/prd/v2.1-agent.md` Phase F, AC-V5; `release-todo.md` §8
- **status:** blocked
- **owner_hint:** FE
- **acceptance:**
  - The hard-disabled "Auto" option is enabled and gated against `AgentMetadata.allowed_autonomy`.
  - Auto-applied tools still require a 10-second toast Undo and an admin per-tool flip validated by shadow data.
  - The explanatory "Available in v3" tooltip is removed once enabled.
- **depends_on:** PRD-GAP-031
- **notes:** Auto is intentionally hard-disabled (`release-todo.md` §8); enabling it is blocked on shadow-mode quality validation (PRD-GAP-031) and the v3 preapproved-tool policy.

### PRD-GAP-033 — Transactional email + web-push delivery layer
- **prd_ref:** `docs/prd/collaboration-notifications.md` §6, AC-N12, AC-N13, AC-N14
- **status:** deferred
- **owner_hint:** BE
- **acceptance:**
  - `notification_service.create` triggers per-event email + web-push side effects routed per-kind by prefs; no delivery-trigger endpoint, no digest/batch.
  - `pushSubscriptions` + `deliveries` collections; `POST/DELETE /push-subscriptions` self-only; retries idempotent on `(notificationId, channel)`.
  - Slack/Confluence/scheduled-digest remain excluded.
- **depends_on:** PRD-GAP-026, PRD-GAP-027
- **notes:** Explicitly "infra-heavy — later" in `feature-build-progress.md`; introduces the repo's first outbound dependency (SMTP/VAPID). Shares the email transport decision with PRD-GAP-023 (OQ-6). The in-app preference half (PRD-GAP-027) ships without this.

### PRD-GAP-034 — Operator: pgvector `task_embeddings` backfill (readiness, not a code gap)
- **prd_ref:** `release-todo.md` §4
- **status:** open
- **owner_hint:** ops
- **acceptance:**
  - Operator runs the resumable backfill dry-run, then `python backend/scripts/backfill_task_embeddings.py --execute --prune-deleted` with `AGENT_VECTOR_DIMENSIONS`/`EMBEDDINGS_DIMENSIONS` matched to the `vector(n)` DDL.
  - `AGENT_VECTOR_SEARCH_ENABLED=true` only after the backfill; retrieval-grade results verified on a sample.
- **depends_on:** none
- **notes:** Code path shipped behind env flags; this is **operator readiness**, not a dev gap. The script exists (`backend/scripts/backfill_task_embeddings.py`). Listed because the review named it; actionable by ops only.

### PRD-GAP-035 — Operator: Redis trio for multi-worker (readiness, not a code gap)
- **prd_ref:** `release-todo.md` §16d
- **status:** open
- **owner_hint:** ops
- **acceptance:**
  - For `UVICORN_WORKERS`/`WEB_CONCURRENCY` > 1, `RATE_LIMIT_BACKEND`/`BUDGET_BACKEND`/`IDEMPOTENCY_BACKEND` are all `redis` with a non-empty `REDIS_URI` (boot otherwise raises by design).
  - Single-worker-per-container horizontal scaling remains valid without Redis.
- **depends_on:** none
- **notes:** Boot-time guard already enforces this (`test_production_backend_guards.py`); the work is **operator configuration/provisioning**, not code. Included per the review's ops list; not a dev task.
