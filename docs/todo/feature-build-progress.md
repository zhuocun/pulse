# Feature build progress — completeness build-out

Implementation of the feature set from the completeness review/brainstorm,
built in dependency-ordered milestones. Each milestone is reviewed +
gated + committed before the next. Branch: `claude/clever-gauss-YckJC`.

> **As-built docs:** M1–M4 (RBAC/membership, task & board richness, comments
> + @mentions, notifications, and the shipped frontend surfaces) are now
> documented as the authoritative contract in
> [`../prd/core-collaboration.md`](../prd/core-collaboration.md), with the HTTP
> details in [`../api/backend.md`](../api/backend.md) /
> [`../api/frontend.md`](../api/frontend.md). This tracker is the forward
> build-out roadmap (the remaining M4 FE work + M5–M8).

## Gate commands (must pass per milestone)
- Backend lint: `cd backend && .venv/bin/ruff check .`
- Backend tests: `cd backend && env -u DEEPSEEK_API_KEY COVERAGE_FILE=/tmp/cov .venv/bin/python -m pytest`
  (CI = `pip install -e ".[dev,ai]"` then `ruff check .` then `pytest`; 85% coverage gate.)
  NOTE: the container sets `DEEPSEEK_API_KEY`; the suite assumes "no key
  => stub provider", so unset it locally to match CI.
- Frontend: `npm run typecheck && npm run eslint && npm test`

### Known PRE-EXISTING failures (not regressions; ignore until AI milestone)
- `tests/test_agents_catalog.py::test_chat_agent_propagates_cancellation_through_provider_call`
- `tests/test_ai_v1_router.py::test_chat_returns_text_via_chat_agent`
  (AI chat-agent response shape; confirmed pre-existing via stash.)

## Milestones
- [x] **M1 — Project membership + RBAC (backend)**. `memberIds:[{userId,role}]`
  (owner>editor>viewer); `can_access(project,user,min_role)`;
  `is_project_manager`=owner shim. Member CRUD `/api/v1/projects/members`
  (owner-only; manager=immutable root of trust). Read=viewer, write=editor
  on task/board. Owner auto-membered; listing=owned+member-of (Python
  filter, FakeStore-safe). Tests: `backend/tests/test_rbac.py`. Gate green
  (ruff, 96% cov). Reviewed APPROVE (no escalation/IDOR/leak).
- [x] **M2 — Task & board richness (backend)**: due/start dates, labels,
  multi-assignee, sub-tasks (`parentTaskId`), per-column WIP limits, bulk
  task endpoint `PUT /api/v1/tasks/bulk`.
- [x] **M3 — Comments + @mentions; Notifications model + bell (backend)**.
- [x] **M4 — Frontend surfaces for M1–M3** (members tab, task fields,
  lensChips dueDate activation, notifications bell, comments UI).
  - [x] M4a: notifications bell + Inbox Mentions wiring (useNotifications, header bell)
  - [x] M4b: task richness in board UI (dates, labels, assignees, sub-task parent, overdue + label chips, date lenses)
  - [x] M4c: comments + @mentions UI — `useComments` hook + `CommentsThread`
    mounted in `TaskModal` (list/create/edit/delete; author-only edit,
    author-or-owner delete; mention multi-select fans out to the
    notifications bell by invalidating the notifications query on a
    mention-bearing create). Closes the producer side of the
    notifications loop (M4a was the consumer).
  - [x] M4d: project member management UI — `/projects/:projectId/members`
    route + `ProjectMembersManager` (roster with roles; owner-gated add /
    change-role / remove; manager row immutable; read-only for
    non-owners) + `useProjectMemberMutations`.
- [ ] **M5 — Unified Copilot rail rebuild; action-capable command palette;
  shared saved views; cross-project search**.
- [ ] **M6 — Reporting (velocity/WIP/throughput); admin AI-gating
  dashboard; keyboard-first surface**.
- [ ] **M7 — Attachments (GridFS); real-time board sync (SSE);
  export/webhooks**.
- [ ] **M8 — Bets: autopilot lanes; org-wide audit history; "plan this
  sprint"**.

### Completeness PRD implementation (in progress)
Implementation of the three completeness PRDs began on this branch as a
sequence of independently reviewed + gated + pushed slices (separate from
the M5–M8 track). Cross-target order: additive/foundational slices first,
the organizations tenancy layer early (it owns the access model the rest
leans on), then broader work-management depth, with recurrence / AI assists
/ email delivery last (they add new runtime deps). Each slice runs
worker → independent reviewer → gate (ruff/pytest + tsc/eslint/jest/
prettier) → commit. The review gate has already caught two real bugs a
green test run hid (a DOM-global type collision; an org-admin privilege
escalation), both fixed before landing.

**[`work-management-depth.md`](../prd/work-management-depth.md)**
- [x] Persisted done-category on `columns` (done-ness source of truth) — `46d6798c`
- [x] Task `priority` enum + board badge + lens chips — `9e4691de`
- [x] Lifecycle — `completedAt` auto-stamp on tasks (server-managed; done-category transitions on create/update/reorder) — `8268c533`
- [x] Lifecycle — task archive/trash soft-delete + restore/archive endpoints + `GET /tasks` default-exclude — `68553cbb`
- [x] Lifecycle — project archive/trash soft-delete + restore/archive + `GET /projects` default-exclude — `d0a7c85e`
- [x] Dependencies — `dependsOn` prerequisite edges + acyclic (cycle-rejecting) validation, bulk-excluded (L-DEP-A) — `fa1ce79a`
- [x] Dependencies — move-to-done gate (`force` override) + `enforceDependencyGate` project flag (L-DEP-B) — `99313869`
- [x] Dependencies — derived `blockedBy` signal on `GET /tasks` (unfinished prerequisites; powers the §4.5 badge) (L-DEP-C) — `40d0f262`
- [x] Milestones — project-scoped `milestones` collection + CRUD (viewer-read/editor-write); `/api/v1/milestones` router + comprehensive RBAC/validation tests (backend) — `143866e4`
- [x] Task→milestone assignment backend (`task.milestoneId` scalar FK + same-project validation + FK-null delete-cascade; bulk-excluded) — `293f3b30`
- [ ] Milestone FE surface (recon `a0a1f195` mapped the integration):
  - [x] FE-MS-1: milestone manager (list/create/edit/delete) — `/projects/:projectId/milestones` route + nav tab + `useMilestones`/`useMilestoneMutations` + `IMilestone`; editor-gated writes (fail-closed `canManage`). No task-modal clear wrinkle — `83cc9d6b`
  - [ ] FE-MS-2: task-modal milestone single-select (mirror `parentTaskId`) + card milestone chip (thread `milestones` board→column→card like `labels`; `Column` is memoized → frozen stable ref). MUST handle the scalar-FK clear-semantics caveat (see carry-forward).
- [ ] Iterations; queryable/paginated `GET /tasks` + list/table/calendar/timeline views + swimlanes
- [ ] Custom fields (scoped allowlist relaxation); project/task templates
- [ ] AI assists (priority / dependency / duplicate, reusing `task_estimation`)
- [ ] Recurring tasks + scheduler (new runtime dep — sequenced last)

**[`accounts-organizations.md`](../prd/accounts-organizations.md)**
- [x] `guest` role at rank 0, below viewer (no `can_access` rewrite) — `70e081fb`
- [x] Organizations tenancy spine: new `organizations` collection + parallel `can_access_org`, dark/additive — `4eb250bd`
- [x] `organizationId` on projects + org-gated create + tenant-scoped listing (null-org fallback) — `f30efe87`
- [ ] String→entity backfill script (distinct-scan → mint orgs → stamp `projects.organizationId`; idempotent, non-destructive)
- [ ] Org/teams frontend (switcher, settings, roster); invite-by-email onboarding
- [ ] Public read-only share links; account/profile management
- [ ] Platform horizon (SSO/OIDC, SCIM, PAT, billing) — high-level

**[`collaboration-notifications.md`](../prd/collaboration-notifications.md)** — not started
- [ ] Watchers/subscriptions; notification breadth + `actorId` + per-kind prefs
- [ ] Comment reactions / threads / edit-history; per-task activity timeline
- [ ] Transactional email + web-push delivery (infra-heavy — later)

**Frontend surfaces — making the landed backend visible**
- [x] Dependency "blocked" badge on board cards (consumes derived `blockedBy`) (FE-1) — `92b4ebef`
- [x] Lifecycle UI — Trash drawer: list soft-deleted tasks + restore + permanent-delete (FE-2) — `20c145a5`
  - [x] FE-2 FIX — filter the widened `?includeTrashed=true` list to `deletedAt`-set rows (active tasks were surfacing as trash) + repair the board trash-button test the filter broke — `a43afd70` / `e31adf95`
- [x] Lifecycle UI — Archive drawer: list archived tasks + unarchive (dedicated `PUT /tasks/archive {archived:false}`) + permanent-delete (FE-2b) — `e31adf95`
- [x] Dependency editor — `dependsOn` multi-select in the task modal + read-only "Blocks" inverse (FE-3) — `f2465d4e`
- [x] `completedAt` "completed" card styling — success badge; supersedes blocked/overdue (FE-4) — `7845b883`

**Also pending — M5 saved-views server model:** work-management-depth
defers saved-view *persistence* to M5, built just before the alternate-views
slice that consumes it.

### Open decisions (carry forward)
- AI/agent routes (`ai.py`, `agents.py`) remain owner-gated. Decide in the
  AI milestone whether editors should get AI access (`can_access(...,
  ROLE_EDITOR)`).
- `memberIds` returned in `GET /projects`. Consider a derived `myRole`
  field during FE integration instead of the raw list.
- Reorder/board ordering does not exclude soft-deleted/archived tasks, so a
  trashed task still occupies an `index` slot (benign — no corruption, since
  soft-delete skips the re-pack). Revisit when the trash/board views land
  (WMD-L2 reviewer note).
- Org delete refuses while the org still owns projects (`organization_service`)
  and counts soft-deleted ones too, so a trashed org-scoped project blocks
  tenant teardown until purged/restored. Defensible for now; revisit (add a
  `deletedAt is None` filter?) when org write paths mature (WMD-L3 reviewer note).
- The dependency move-to-done gate counts a soft-deleted/archived prerequisite
  (still in a non-done column) as unfinished, so it blocks (conservative; `force`
  + `enforceDependencyGate` are escape hatches). Decide whether a trashed prereq
  should stop blocking — 2-line guard if so (L-DEP-B reviewer note).
- `GET /tasks` `includeTrashed`/`includeArchived` flags WIDEN the result
  (active + hidden); they do NOT scope it to only-hidden, so the Trash /
  Archive drawers filter the widened list client-side on `deletedAt` /
  `archivedAt` (documented on `ITask`). A task that is BOTH trashed AND
  archived is invisible in both drawers (each query excludes the other
  marker) — UI-unreachable today (no path sets both); revisit if a "move to
  trash from archive" action lands.
- Process: an FE change to a SHARED/rendered component must run the FULL jest
  suite, not just the component's own test — the pre-commit hook runs
  tsc/eslint/prettier/smoke but NOT jest, so a broken consumer test slips
  through. The trash filter (`a43afd70`) broke `board.test.tsx`'s trash-button
  test (its fixtures set no `deletedAt`); caught + fixed in `e31adf95`.
- FE clear-semantics for nullable scalar FKs (`task.milestoneId`,
  `parentTaskId`): `filterRequest` (`utils/filterRequest.ts`) strips
  `null`/`undefined`/`""` from every request body (used by
  useReactMutation/useReactQuery), so a task-modal single-select cleared to
  null reaches the wire as an ABSENT KEY, and the task PUT
  (`_TASK_UPDATE_FIELDS` filter) treats absent = unchanged → the FK silently
  reverts on refetch. Multi-selects dodge this (`[]` is non-void, like
  `dependsOn`); a scalar FK has no non-void "empty" sentinel. So FE-MS-2
  (task-modal milestone select) must add a targeted escape hatch to send an
  explicit `milestoneId: null` past `filterRequest` (or a backend
  clear-sentinel), and should check whether `parentTaskId` clear has the same
  latent gap. The milestone MANAGER (FE-MS-1) sidesteps this entirely (it
  drives milestone CRUD, not the task PUT). Recon: `a0a1f195`.

### Excluded (per review "don't build")
MCP, voice, CRDT co-editing, four-level autonomy dial, configurable
end-user prompts, cross-project planning.
