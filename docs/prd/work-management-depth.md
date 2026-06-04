# PRD: Pulse — Work-Management Depth

| Field             | Value                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status            | Draft v1 — proposed. Net-new completeness features that deepen the work-management core; backend + frontend are both unbuilt unless a partial substrate is noted (see the status legend).                                             |
| Author            | Product / Engineering — completeness proposal                                                                                                                                                                                       |
| Last updated      | 2026-06-04                                                                                                                                                                                                                          |
| Target repository | `pulse` (frontend `src/`; backend `backend/`, FastAPI + MongoDB)                                                                                                                                                                    |
| Document scope    | the next layer of work-management depth on top of the as-built core — task priority, dependencies, lifecycle/archive/trash, recurrence, templates, custom fields, milestones, alternate views, and the AI assists that consume them. |
| Companion docs    | [`collaboration-notifications.md`](collaboration-notifications.md), [`accounts-organizations.md`](accounts-organizations.md), [`core-collaboration.md`](core-collaboration.md) (the as-built substrate), [`v2.1-agent.md`](v2.1-agent.md), [`v3-ai-ux.md`](v3-ai-ux.md), [`../api/backend.md`](../api/backend.md), [`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) |

---

## 1. TL;DR / Overview

The Pulse core (documented as-built in [`core-collaboration.md`](core-collaboration.md)) ships a complete, server-side collaboration layer: RBAC projects, kanban columns with WIP limits, rich tasks (scheduling, labels, multiple assignees, one-level sub-tasks), bulk edits, comments, and notifications. It is deep on *structure* but shallow on *workflow*. A team can put a card on a board; it cannot say the card is **urgent**, that it is **blocked by** another card, that it should **recur** every Monday, that it belongs to **Sprint 12**, or that "Done" means anything more precise than a column whose name happens to contain the word "done". And the only way to look at the work is the single kanban board — there is no list, table, calendar, or timeline.

This PRD specifies that missing depth as a single coherent layer. Nine feature sections add the workflow primitives a mature work-management tool is expected to have — **priority** (§3), **dependencies / blockers** (§4), **lifecycle, archive & trash** (§5), **recurring tasks** (§6), **project & task templates** (§7), **custom fields** (§8), and **milestones / iterations** (§9) — plus an **alternate-views** layer over the existing data (§10) and a consolidation of the **AI assists** that ride on top of them (§11). Each is specified against the real tree, in the same data-model and HTTP conventions the core already uses.

Three facts a reader must internalise up front:

1. **Almost none of this exists yet.** Every feature here is a proposal. The status glyph on each section marks its current substrate honestly — mostly ⬜ (nothing built), with a handful of 🔧/🟡 where a partial substrate already exists (e.g. `storyPoints` for estimation, the embedding/similarity infra for duplicate detection, the `tasks` date fields for a calendar view).
2. **Two changes touch the architecture, not just the schema.** Recurring tasks (§6) introduce the **first background-worker dependency** in the system — there is no scheduler anywhere today. Custom fields (§8) require the **only relaxation of the `TABLE_FIELDS` write allowlist** this layer proposes (`repositories.py` `validate_fields` rejects any unknown key today). Both are called out explicitly and scoped narrowly.
3. **This layer defers cleanly to the planned milestones.** Reporting/velocity/WIP/throughput dashboards (M6), attachments and real-time sync (M7), org-wide audit and autopilot/"plan this sprint" AI (M8), and the unified Copilot rail + shared **saved views** + cross-project search (M5) are cross-referenced and **not re-specified here**. Where this PRD is adjacent to an explicitly-excluded idea (CRDT co-editing, AI drag-and-drop, four-level autonomy dial, etc.) it says "out of scope" rather than drifting into it.

The substrate this layer assumes — auth, the Mongo repository, the `can_access` RBAC model, the sentinel→HTTP convention — is owned by [`core-collaboration.md`](core-collaboration.md) and [`../api/backend.md`](../api/backend.md) and is referenced, not re-specified.

---

## 2. Context & Scope

### 2.1 Relationship to the as-built core and the planned milestones

This document is a **consumer** of the core data model and a **predecessor** of the M5–M8 milestones. The dividing lines:

| Concern                                                                 | Owner                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Projects, RBAC, columns, tasks, labels, comments, notifications (as-built) | [`core-collaboration.md`](core-collaboration.md)                  |
| Workflow depth: priority, dependencies, lifecycle, recurrence, templates, custom fields, milestones, view layouts, work-mgmt AI assists | **this document**                                                 |
| Reporting / velocity / burndown / WIP / throughput dashboards            | **M6** — deferred (this PRD emits the *data*, not the analytics)  |
| Attachments (GridFS), real-time board sync (SSE), export + webhooks       | **M7** — deferred                                                 |
| Org-wide audit history, autopilot lanes, "plan this sprint" AI            | **M8** — deferred                                                 |
| Unified Copilot rail, action-capable command palette, shared **saved views**, cross-project search | **M5** — deferred (this PRD owns the view *layouts*; M5 owns their persistence) |

The AI contract — agents, autonomy model, SSE transport, the server-authoritative mutation journal — is owned by [`v2.1-agent.md`](v2.1-agent.md) / [`v3-ai-ux.md`](v3-ai-ux.md). §11 adds **no new agent runtime**: it adds suggest-only surfaces inside the existing framework and the existing autonomy gates.

### 2.2 Goals & Non-goals

**Goals**

- **G1 — Add the missing workflow primitives.** Priority, dependencies, a real done-category, archive/trash, recurrence, templates, custom fields, and milestones — each as a typed extension of the existing collections, validated and RBAC-gated like the core.
- **G2 — Make "done" persisted, not inferred.** Replace the name-string / FE-snapshot heuristic for done-ness (`be_tools.py:324-330`) with a stored `category` on `columns` and explicit `completedAt` on tasks (§5).
- **G3 — Make the board queryable.** Add the filter/sort/pagination query params and Mongo indexes the alternate views need on `GET /api/v1/tasks` (today a single unfiltered, unpaginated full scan — `task_service.py:203-244`).
- **G4 — Give the work more than one shape.** A list, table, calendar, and timeline over the *existing* task data, plus board swimlanes (§10) — the view *layouts*, with persistence deferred to M5.
- **G5 — Consolidate, not multiply, the AI.** Surface auto-prioritisation, dependency suggestions, and duplicate detection through the *existing* agent framework and the *existing* similarity infra (§11) — no new runtime, no new autonomy model.
- **G6 — Keep the two architectural changes small and explicit.** Scope the scheduler dependency (§6) and the `TABLE_FIELDS` relaxation (§8) to exactly what each feature needs, and call both out in Rollout (§14).

**Non-goals**

- **N1 — Reporting & analytics.** Velocity, burndown, cycle time, throughput, and the WIP/aging dashboards are **M6**. This layer emits the underlying data (priority, `completedAt`, milestone membership) but specifies **no** charts. The placeholder `reports.tsx` stays a placeholder until M6.
- **N2 — Real-time multi-client sync, attachments, export, webhooks.** **M7.** A recurring task instantiated by the scheduler appears on a client's *next* poll, not via push.
- **N3 — A new AI runtime or a new autonomy model.** §11 reuses [`v2.1-agent.md`](v2.1-agent.md). Out of scope (and not proposed anywhere): MCP, voice, CRDT/Yjs co-editing, a four-level autonomy dial, configurable end-user prompts, AI-driven drag-and-drop, inline `/copilot` slash commands, multi-agent orchestration UI.
- **N4 — Cross-project anything.** Cross-project planning, search, and the shared saved-view registry are **M5**. Every collection in this PRD is project-scoped.
- **N5 — Re-architecting persistence.** The single-tenant Mongo model stays. New indexes are additive; the operator-free query contract is preserved except for the explicitly-scoped `customFields` shape validation (§8) and the new `GET /tasks` filters (§10).

### 2.3 Status legend

Used in every "Current state" callout below. Because these are **proposals**, the glyph marks the feature's **current substrate**, not a shipped state.

| Symbol | Meaning                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------- |
| ✅     | **Shipped** — backend complete AND a working FE surface exists.                                  |
| 🟡     | **Partial** — backend complete; FE incomplete OR the substrate is only partially in place.       |
| 🔧     | **Backend-only** — backend exists; no FE surface consumes it.                                    |
| ⬜     | **Planned** — not built.                                                                         |

---

## 3. Task Priority

### 3.1 Current state

Tasks have **no priority concept of any kind**. The `tasks` allowlist (`repositories.py:45-67`) carries `storyPoints` (effort) but nothing for urgency/importance; there is no `priority` field, and `GET /api/v1/tasks` neither sorts nor filters by anything but `index` (`task_service.py:203-244`). The board cards (`src/components/column/index.tsx`) render the coordinator avatar, label chips, an overdue chip from `dueDate`, and story points — there is no priority badge, and the lens chips filter on `dueDate` / `coordinatorId` only. A `priority` literal does not exist anywhere in `src/` (the only `priority` matches are unrelated CSS layering). The AI triage surface ([`v2.1-agent.md`](v2.1-agent.md)) can *describe* drift but has nowhere to write a priority.

### 3.2 Proposed model

Add a single enum field to `tasks`:

- **`priority`** — `str`, one of `"none" | "low" | "medium" | "high" | "urgent"`. Default `"none"`. New key in `TABLE_FIELDS[tasks]` (`repositories.py`); validated by a `_priority_error` helper in `task_service.py` that mirrors the existing `storyPoints` / `wipLimit` validators (reject any value outside the five-member enum → `"Bad request"`).

A **derived rank** (`urgent=4 … none=0`) is computed server-side for sorting only; it is never stored. No new collection, no new endpoint shape — priority is set through the **existing** task write paths:

| Method | Path                      | Required role | Behaviour                                                                                          |
| ------ | ------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `PUT`  | `/api/v1/tasks/`          | `editor`      | Update `priority` alongside any other task field; invalid enum → `"Bad request"` (400).            |
| `PUT`  | `/api/v1/tasks/bulk`      | `editor`      | Set `priority` across many tasks — `priority` joins `_BULK_CHANGE_FIELDS` (`task_service.py:39`); already excludes `columnId`/`projectId`. All-or-nothing on validation, `editor`-gated on every task's project. |

Sorting/filtering by priority is part of the `GET /tasks` query-param work in §10.4 (`sortBy=priority`, `priority=high,urgent`); the derived rank drives the sort.

### 3.3 AI auto-prioritisation assist

A **suggest-only** assist inside the existing agent framework (cross-ref the [`v2.1-agent.md`](v2.1-agent.md) triage agent — this is the same surface, given a priority output slot). It reads the FE-supplied board/task snapshot via the existing LangGraph `interrupt()` payload (signals already available to triage: `dueDate` proximity, `type=="bug"` without a coordinator, staleness, blocking-edge count from §4) and emits a `{kind:"suggestion", surface:"priority", payload:{taskId, priority, rationale}}` event. It is governed by the **existing autonomy model**: in `suggest` mode the user accepts/dismisses; any accepted change is written through `PUT /tasks` (or `PUT /tasks/bulk` for a batch) and recorded in the server-authoritative mutation journal — the assist itself **never** writes priority directly. No model identifier, no new agent runtime, no auto-apply beyond what the existing autonomy gates already permit.

### 3.4 UX / surface

- A **priority badge** on the card (`src/components/column/index.tsx` `TaskCard`) — glyph + text label + `aria-label`, never colour-only (matching the overdue-chip accessibility rule already in that file). `"none"` renders nothing.
- A **priority `Select`** in both task-edit surfaces (`src/components/taskModal/index.tsx` and — when its richness gap is closed — `src/components/taskDetailPanel/index.tsx`).
- A **priority lens chip** alongside the existing `dueDate` lens (`src/components/lensChips/`).
- The AI suggestion renders as a dismissible card affordance, consistent with the existing triage UX ([`v3-ai-ux.md`](v3-ai-ux.md)).

### 3.x Current state — ⬜ Planned

No `priority` field, no badge, no sort/filter, no assist surface today; the only adjacent substrate is the triage agent that will host the assist.

---

## 4. Task Dependencies / Blockers

### 4.1 Current state

There is **no dependency concept**. `tasks` has `parentTaskId` for **sub-tasks** — a strictly **one-level**, same-project, no-self-parent hierarchy (`repositories.py:63-64`, validated by `_parent_task_error` in `task_service.py`) — but that models *containment* (a child belongs to a parent), not *ordering* (this must finish before that starts). There is no `dependsOn`, no `blockedBy`, no "blocked" signal on cards, and nothing prevents moving a task whose prerequisites are unfinished into a done column (done-ness itself is only name-inferred today — `be_tools.py:324-330`). No `dependsOn` / `blockedBy` literal exists in `src/`.

### 4.2 Proposed model — distinct from sub-tasks

Add one stored edge list to `tasks`; derive its inverse:

- **`dependsOn`** — `list[str]` of task `_id`s this task is **blocked by** (its prerequisites). Default `[]`. New key in `TABLE_FIELDS[tasks]`.
- **`blockedBy`** — **derived, never stored.** Computed and returned on read by inverting `dependsOn` across the project's task set. (The name "blockedBy" is the *reader-facing* inverse: task A `dependsOn` B ⇒ A is `blockedBy` B; B's `blocks` list contains A.) Surfacing it is part of the `GET /tasks` response shape, not a column in `TABLE_FIELDS`.

**Validation** (`_depends_on_error` in `task_service.py`, run on create/update/bulk):

- Each id must **exist** and be **same-project** (mirrors the `parentTaskId` checks).
- **No self-dependency** (a task may not depend on itself).
- **Cycle prevention.** Adding edge A→B is rejected with `"Bad request"` if B already transitively `dependsOn` A. The check walks the project's `dependsOn` graph (bounded by the project's task count; the project task set is already a single scan) and rejects any edge that would close a cycle. This is a real graph walk, not the one-hop self-guard `parentTaskId` uses — dependencies are a DAG, sub-tasks are a one-level tree.

> **Sub-task vs dependency — keep them straight.** `parentTaskId` answers "what is this part of?" (one level, containment, orphan-on-delete). `dependsOn` answers "what must happen first?" (arbitrary-depth DAG, ordering, gating). A task can have both a parent and prerequisites; they never substitute for each other.

| Method | Path                  | Required role | Behaviour                                                                                       |
| ------ | --------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/tasks/`      | `editor`      | Create with `dependsOn` (validated, same-project, acyclic).                                      |
| `PUT`  | `/api/v1/tasks/`      | `editor`      | Replace `dependsOn`; cycle/self/cross-project → `"Bad request"` (400).                           |
| `PUT`  | `/api/v1/tasks/bulk`  | `editor`      | `dependsOn` is **excluded** from `_BULK_CHANGE_FIELDS` — fanning one prerequisite set across many tasks is almost always wrong and makes per-task cycle validation ambiguous; dependency edits go through the single-task path. |

### 4.3 Move-to-done gating

When a task is moved into a column whose persisted `category == "done"` (§5) while it still has **unfinished** prerequisites (any task in `dependsOn` whose own column is not `done`), the move is, by default, **warned** at the FE and **soft-gated** at the API: `PUT /tasks/orders` (or `PUT /tasks` with a `columnId` change) returns `"Bad request"` with a machine-readable reason unless the request carries an explicit `force:true` override (an `editor` may knowingly override). The gate is opt-outable per project via a project setting (`enforceDependencyGate: bool`, default `true`) so teams that treat dependencies as advisory are not blocked. Without the persisted done-category from §5 this gate cannot exist — which is why §5 is a prerequisite of §4.3.

### 4.4 AI dependency-suggestion assist

A **suggest-only** assist (existing framework, cross-ref §11 and [`v2.1-agent.md`](v2.1-agent.md)) that proposes likely `dependsOn` edges from the FE-supplied task corpus — e.g. tasks sharing an `epic` or `milestoneId` with strong title/`note` token overlap (the same `jaccard`/`token_set` machinery already in `catalog/task_estimation.py`). It emits `{kind:"suggestion", surface:"dependency", payload:{taskId, dependsOn:[...], rationale}}`; acceptance writes through `PUT /tasks` and is journaled. Suggestions that would introduce a cycle are filtered server-side before they are surfaced.

### 4.5 UX / surface

- A **"blocked" badge** on cards (`src/components/column/index.tsx`) when the task has ≥1 unfinished prerequisite — glyph + "Blocked" text + `aria-label`.
- A **dependency editor** in the task-edit surface: an add/remove list of same-project tasks for `dependsOn`, plus a read-only "Blocks" list (the derived inverse).
- The timeline view (§10) draws dependency edges between bars.

### 4.x Current state — ⬜ Planned

No `dependsOn`/`blockedBy`, no cycle check, no blocked badge, no gate, no assist; `parentTaskId` is the only related (and deliberately different) field.

---

## 5. Task Lifecycle, Archive & Trash

### 5.1 Current state

Two gaps compound here. First, **done-ness is not persisted.** `columns` carries `columnName`, `projectId`, `index`, `wipLimit` (`repositories.py:33-44`) — there is **no** done-category. The drift detector infers "done" from a hard-coded multilingual column-name set or an `isDone` flag that arrives in the FE snapshot and is **never stored** (`be_tools.py:324-330`, `_is_done_column`). Rename "Done" to "Shipped to prod" in the wrong language and the heuristic silently breaks. Second, **every delete is hard.** Project delete cascades tasks→columns→project; task delete orphans sub-tasks and re-packs indices — both irreversible, with no trash, no restore window. Tasks have no `completedAt`/`archivedAt`; projects have no `archivedAt`; list endpoints return everything unconditionally.

### 5.2 Proposed model — a real done-category

Add a persisted category to `columns`:

- **`category`** — `str`, one of `"todo" | "in_progress" | "done"`. Default `"todo"`; the `column_seed.py` defaults seed `("To Do"→"todo", "In Progress"→"in_progress", "Done"→"done")`. New key in `TABLE_FIELDS[columns]`.
- **`isDone`** — derived alias (`category == "done"`) on read, so the existing `be_tools._is_done_column` snapshot consumer keeps working unchanged while the *source of truth* becomes the stored `category` instead of a name match.

`be_tools._is_done_column` is updated to prefer the stored `category` (falling back to the name heuristic only for legacy columns that predate the field), so done-ness stops being locale-fragile. `category` is set on `POST`/`PUT /api/v1/boards/` (`editor`, validated against the three-member enum).

### 5.3 Proposed model — completion & archive timestamps

| Field          | Collection | Type            | Semantics                                                                                  |
| -------------- | ---------- | --------------- | ------------------------------------------------------------------------------------------ |
| `completedAt`  | `tasks`    | ISO `str`/`null`| Set when a task enters a `category=="done"` column; cleared when it leaves. Server-managed on `PUT /tasks` / `PUT /tasks/orders`, never client-written. |
| `archivedAt`   | `tasks`    | ISO `str`/`null`| Soft-archive marker. `null` = active.                                                      |
| `archivedAt`   | `projects` | ISO `str`/`null`| Project-level archive marker.                                                              |
| `deletedAt`    | `tasks`, `projects` | ISO `str`/`null` | Soft-delete (trash) marker; `null` = not trashed.                                  |

All four are new keys in the respective `TABLE_FIELDS` entries (`repositories.py`).

### 5.4 Soft-delete, trash & restore

Today `DELETE` is destructive. The proposal makes the default a **soft delete** and adds restore + a purge window:

| Method   | Path                          | Required role | Behaviour                                                                                          |
| -------- | ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `DELETE` | `/api/v1/tasks/`              | `editor`      | **Soft-delete** by default: set `deletedAt`. Sub-task orphaning is deferred until purge, not on soft-delete. A `?purge=true` query performs the legacy hard delete (still `editor`). |
| `PUT`    | `/api/v1/tasks/restore`       | `editor`      | Clear `deletedAt` (and `archivedAt` if set) by `_id`; → `"Task restored"` / `"...not found"` (404).|
| `PUT`    | `/api/v1/tasks/archive`       | `editor`      | Set/clear `archivedAt` by `_id` (`{archived: bool}`).                                              |
| `DELETE` | `/api/v1/projects/`           | **manager-only** | Soft-delete by default (`deletedAt`); `?purge=true` runs the legacy cascade (tasks→columns→project). |
| `PUT`    | `/api/v1/projects/restore`    | **manager-only** | Clear project `deletedAt`/`archivedAt`.                                                        |
| `PUT`    | `/api/v1/projects/archive`    | **manager-only** | Set/clear project `archivedAt`.                                                                |

**Restore window.** Trashed rows are retained for a fixed window (proposed **30 days**) and then eligible for hard purge. Because there is no scheduler today, purge is **opt-in / request-driven** until the §6 scheduler lands, at which point an existing scheduled sweep can reclaim expired trash; this dependency is recorded in Rollout (§14). (This is **not** the 24h client-side drawer undo, which is explicitly out of scope — this is server-persisted trash with an explicit restore endpoint.)

### 5.5 Default-exclude filters

Every list endpoint that scans tasks/projects gains a **default exclusion** of trashed and archived rows, with explicit opt-in:

- `GET /api/v1/tasks` excludes `deletedAt != null` and `archivedAt != null` by default; `includeArchived=true` / `includeTrashed=true` opt back in (part of the §10.4 query-param work). Trash/archive views set these flags.
- `GET /api/v1/projects` excludes soft-deleted/archived projects by default; the same opt-in flags apply.

### 5.6 UX / surface

- A **column-category picker** on column create/edit (the first time `wipLimit` and `category` get a real settings surface — today neither has one).
- A **Trash** and an **Archive** view (rows of soft-deleted / archived items with a one-click **Restore**), reachable from the project nav.
- "Completed" styling on cards driven by `completedAt` rather than a name guess.

### 5.x Current state — ⬜ Planned

No persisted done-category (name-inferred only), no `completedAt`/`archivedAt`/`deletedAt`, all deletes hard, no trash/restore, no default-exclude filters.

---

## 6. Recurring Tasks

### 6.1 Current state

There is **no recurrence and no scheduler — anywhere.** Tasks are static documents; nothing re-creates them. The codebase is **entirely request-driven**: there is no Celery, no APScheduler, no cron entrypoint, no background loop of any kind. The only "future scheduling" reference in the system is the v2.1 triage agent's note that a scheduled drift sweep is *future* work — i.e. the scheduler is acknowledged as not-yet-existing. No `recurrence` literal exists in `src/` or `backend/app/`.

### 6.2 Proposed model — an rrule-like recurrence

Add a recurrence rule to `tasks`:

- **`recurrence`** — `dict | null`, shape `{freq, interval, byweekday?, until?, count?}`:
  - `freq` — `"daily" | "weekly" | "monthly"` (required when `recurrence` is non-null).
  - `interval` — positive `int` (default `1`).
  - `byweekday` — optional `list[int]` (0=Mon … 6=Sun), only meaningful for `weekly`.
  - **`until`** (ISO date `str`) **xor `count`** (positive `int`) — the stop condition; at most one may be set. A rule with neither recurs indefinitely.

New key in `TABLE_FIELDS[tasks]`. Validated by `_recurrence_error` in `task_service.py` (**shape-only**: enum `freq`, positive `interval`/`count`, `byweekday` ints in range, `until` a string, `until`-xor-`count`) → `"Bad request"` on violation. The *template* task carries the rule; instantiated occurrences are ordinary tasks (the scheduler may stamp `recurrenceParentId` on each occurrence so a series is traceable — also a new `tasks` key).

```json
{ "freq": "weekly", "interval": 1, "byweekday": [0], "count": 12 }
```

### 6.3 The scheduler worker (new dependency)

This feature **introduces the first background-worker dependency in Pulse.** The proposal:

- A **scheduler worker** (e.g. APScheduler embedded in the FastAPI app, or a separate worker process) that, on a periodic tick, finds tasks with a non-null `recurrence` and **instantiates the next occurrence** — either when the current occurrence is completed (enters a `category=="done"` column, §5) or when the rule's next scheduled date arrives, depending on a per-rule `mode` (`"on_complete" | "on_schedule"`, default `"on_complete"`). Instantiation clones the task into the same project/column with shifted `startDate`/`dueDate`, fresh timestamps, cleared `completedAt`, and `recurrenceParentId` set.
- It honours `until`/`count` (stops emitting when exhausted) and writes through the **same repository + `validate_fields` allowlist** as any other task create, so a recurring task can never bypass schema validation.
- It is the natural home for the §5.4 **trash-purge sweep** and the future v2.1 triage-drift sweep — i.e. this PRD proposes the *shared scheduling substrate*, not a recurrence-only worker. Rollout (§14) flags the new operational surface (process/deployment, idempotency under multiple workers, missed-tick catch-up).

Because instantiation is server-side and asynchronous, a new occurrence appears on the client's **next poll** (no real-time push — that is M7).

### 6.4 UX / surface

- A **recurrence editor** in the task-edit surface: a frequency/interval/weekday/stop-condition control that serialises to the `recurrence` shape.
- A **recurring glyph** on cards whose `recurrence` is non-null, and a "next occurrence" hint.
- Editing the rule on the series template affects future occurrences only; already-instantiated occurrences are independent tasks.

### 6.x Current state — ⬜ Planned

No `recurrence` field and — critically — **no scheduler exists at all**; this feature is the system's first background-worker dependency.

---

## 7. Project & Task Templates

### 7.1 Current state

Project creation is **fixed**: it always seeds the **same three columns** `("To Do", "In Progress", "Done")` via `column_seed.ensure_default_columns` and an optional default task — there is no way to start a project from a saved shape, and no concept of a reusable task. There is no `isTemplate` flag and no `templates` collection.

### 7.2 Proposed model

Introduce templates as a small new collection plus instantiate endpoints. (A flag on the live entity — `isTemplate: bool` — was considered but rejected: it would let a half-built template appear in live list scans and entangle the trash/archive filters of §5. A separate collection keeps templates out of the working board entirely.)

- **`templates`** collection (`TABLE_FIELDS[templates]`):
  - `_id`, `projectId` (owning project; templates are project-scoped, matching §2.2 N4), `kind` (`"project" | "task"`), `name`, `description`,
  - `payload` — a typed snapshot: for `kind=="project"`, `{columns:[{columnName, index, category, wipLimit}], labels:[{name, color}], tasks:[{taskName, type, epic, storyPoints, priority, checklist?}]}`; for `kind=="task"`, a single `{taskName, type, epic, storyPoints, priority, note, checklist?}`.
  - `createdAt`, `updatedAt`.
- **`checklist`** — `list[{text, done}]` embedded in a task-template `payload` (and, optionally, a new `checklist` key on `tasks` so an instantiated task carries its checklist). The checklist is a lightweight in-task list, **not** a sub-task tree (§4.2) and **not** a comment thread.

| Method   | Path                              | Required role | Behaviour                                                                                          |
| -------- | --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/templates/`              | `viewer`      | List a project's templates (`?projectId`), or one by `?templateId`.                                |
| `POST`   | `/api/v1/templates/`              | `editor`      | Create a template (capture current columns/labels/tasks, or an explicit `payload`).                |
| `PUT`    | `/api/v1/templates/`              | `editor`      | Update `name`/`description`/`payload`.                                                              |
| `DELETE` | `/api/v1/templates/`              | `editor`      | Delete (`?templateId`).                                                                             |
| `POST`   | `/api/v1/templates/instantiate`   | see below     | Materialise a template. `kind=="task"` → seeds a task in `{projectId, columnId}` (**`editor`** on that project). `kind=="project"` → creates a **new** project seeded from the template instead of the fixed three columns (**authenticated**; caller becomes manager, exactly like `POST /projects`). |

Instantiation runs through the normal services (so RBAC, `validate_fields`, and seeding invariants all apply); a `project`-kind instantiate **replaces** the `column_seed` default rather than layering on top of it.

### 7.3 UX / surface

- A **"Save as template"** action on a project (and on a task) and a **template gallery** in the create-project / create-task flow, so a new project can start from a saved shape instead of always the default three columns.
- A **checklist** sub-section in the task-edit surface (add/check/remove items).

### 7.x Current state — ⬜ Planned

Project create always seeds the same three columns (`column_seed.py`); no templates collection, no instantiate path, no checklist.

---

## 8. Custom Fields

### 8.1 Current state

The `tasks` schema is a **closed allowlist**. `validate_fields` (`repositories.py:143-147`) rejects **any** key not in `TABLE_FIELDS[tasks]` on every write — that is the whole point of the allowlist, and it is why a team cannot add a "Customer", "Severity", or "Sprint goal" field of their own. There is no per-project field-definition store and no extensible map on `tasks`. No `customFields` literal exists in `backend/app/` (the `src/` matches are unrelated UI intensity helpers).

### 8.2 Proposed model — and the central architectural change

Custom fields are the **one place this layer must relax the write allowlist**. The design keeps that relaxation as narrow as possible.

- **`customFieldDefs`** collection (`TABLE_FIELDS[customFieldDefs]`) — per-project definitions:
  - `_id`, `projectId`, `key` (stable machine key, unique per project), `label` (display), `type` (`"text" | "number" | "select" | "date" | "checkbox"`), `options` (`list[str]`, required iff `type=="select"`), `index` (display order), `createdAt`, `updatedAt`.
- **`customFields`** on `tasks` — a **single new allowlisted key** holding a `dict[str, Any]` map of `{ <defKey>: <typed value> }`. Default `{}`.

**The relaxation (scoped).** `customFields` is added to `TABLE_FIELDS[tasks]` as **one** allowed key. The allowlist therefore still rejects unknown *top-level* task keys — it does **not** open the document. What changes is *inside* that one key: `validate_fields` cannot enumerate the dynamic `defKey`s, so a new `_custom_fields_error` in `task_service.py` validates the **map shape**, not each dynamic key:

- `customFields` must be a `dict` with `str` keys.
- Each key must match an existing `customFieldDefs.key` for the task's project (unknown keys → `"Bad request"`); each value must **type-check** against that def's `type` (`number`→finite number, `date`→ISO string, `select`→one of `options`, `checkbox`→`bool`, `text`→string).

So the central change is precise: **relax `TABLE_FIELDS` for exactly one nested map, and validate the map's *shape* against `customFieldDefs` in the service layer rather than enumerating dynamic keys in the repository.** The repository allowlist stays the gate for everything else.

| Method   | Path                          | Required role | Behaviour                                                                                          |
| -------- | ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/custom-fields/`      | `viewer`      | List a project's field definitions (`?projectId`).                                                 |
| `POST`   | `/api/v1/custom-fields/`      | `owner`      | Create a definition (schema change → `owner`, like other project-shape edits). `select` requires `options`. |
| `PUT`    | `/api/v1/custom-fields/`      | `owner`      | Update `label`/`options`/`index`. Changing `type` or `key` is **rejected** (would invalidate stored task values). |
| `DELETE` | `/api/v1/custom-fields/`      | `owner`      | Delete a definition (`?fieldId`); **cascade-strips** that key from every same-project task's `customFields` map (mirrors the label-delete cascade). |
| `PUT`    | `/api/v1/tasks/`              | `editor`      | Set `customFields` values on a task (validated against the project's defs).                         |

Definition CRUD is `owner`-gated because adding a field is a **project-shape** change (consistent with how the core treats member/project-shape mutations); writing *values* into an existing field is an ordinary `editor` task edit.

### 8.3 UX / surface

- A **project settings** panel to manage field definitions (add/edit/reorder/remove).
- Definition-driven inputs in the task-edit surface (a `text` input, `number` input, `Select` from `options`, `DatePicker`, `checkbox`).
- Custom-field columns are selectable in the **table view** (§10) and groupable as **swimlanes** where the field type is discrete (`select`/`checkbox`).

### 8.x Current state — ⬜ Planned

No `customFieldDefs`, no `customFields`; the `TABLE_FIELDS` allowlist (`repositories.py`) rejects every unknown key — relaxing it for this one nested map is the load-bearing architectural change of this PRD.

---

## 9. Milestones / Iterations (Cycles)

### 9.1 Current state

Grouping is **string-only**. A task's `epic` is a **free string** (`repositories.py:49`) with no entity behind it — no dates, no goal, no membership, no progress. There is no milestone/iteration/sprint/cycle concept, and `/reports` is an explicit placeholder (`src/pages/reports.tsx` — "the metrics engine (velocity, burndown, cycle time) is still in design"). There is no `milestoneId` on `tasks`.

### 9.2 Proposed model

Add a lightweight per-project cycle entity and a membership pointer:

- **`milestones`** collection (`TABLE_FIELDS[milestones]`):
  - `_id`, `projectId`, `name`, `startDate` (ISO `str`), `endDate` (ISO `str`), `goal` (`str`, free), `status` (`"planned" | "active" | "completed"`, default `"planned"`), `createdAt`, `updatedAt`.
- **`milestoneId`** on `tasks` — `str | null`, the task's milestone (or `null`). New key in `TABLE_FIELDS[tasks]`; validated same-project on write (mirrors `parentTaskId`/`columnId`).

| Method   | Path                       | Required role | Behaviour                                                                                          |
| -------- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/milestones/`      | `viewer`      | List a project's milestones (`?projectId`), or one by `?milestoneId`.                              |
| `POST`   | `/api/v1/milestones/`      | `editor`      | Create (`name` required; `endDate` ≥ `startDate` when both set, else `"Bad request"`).             |
| `PUT`    | `/api/v1/milestones/`      | `editor`      | Update `name`/dates/`goal`/`status`.                                                               |
| `DELETE` | `/api/v1/milestones/`      | `editor`      | Delete (`?milestoneId`); **cascade-clears** `milestoneId` on same-project tasks (no dangling refs).|

**Progress is a count, not analytics.** The milestone read returns a basic completion ratio — `{ total, done }` where `done` counts member tasks in a `category=="done"` column (§5). That is the *only* metric this PRD specifies.

### 9.3 Explicitly deferred

- **Velocity, burndown, cycle-time, and any chart** are **M6 reporting** — not specified here. This PRD emits the data (`milestoneId`, `completedAt`, the `{total, done}` count); the dashboards consume it later.
- The **AI "plan this sprint"** capability (auto-fill a milestone from the backlog) is **M8** — cross-referenced, not specified. §11's assists do not plan milestones.

### 9.4 UX / surface

- A **milestone picker** in the task-edit surface and a **milestone selector** in the project nav.
- A **milestone swimlane / group-by** on the board (§10) and a compact `{done}/{total}` progress chip on the milestone header. No burndown chart here.

### 9.x Current state — ⬜ Planned

`epic` is a free string with no entity; no `milestones` collection, no `milestoneId`; `/reports` is a placeholder.

---

## 10. Alternate Views (List / Table / Calendar / Timeline) + Swimlanes

### 10.1 Current state

There is exactly **one view: the kanban board** (`src/pages/board.tsx`, the only board surface mounted in `src/routes/index.tsx`). There is **no list, table, calendar, or timeline view** anywhere — grep-confirmed; the "calendar" matches in the code are date-handling comments (e.g. the overdue rule in `src/components/column/index.tsx:455`), not view components. The data needed for richer views **already exists but is unused on most axes**: `startDate` is **never displayed** (only `dueDate` drives the overdue chip and lens), `assigneeIds` is not surfaced on cards (only the single `coordinatorId` avatar), and there are **no swimlanes** — the board is flat columns. Critically, the backend cannot serve these views efficiently: `GET /api/v1/tasks` is a **single unfiltered, unpaginated full scan** (`task_service.py:203-244`; `database.find_many` is unbounded), with the only ordering being `index`.

### 10.2 Proposed view layer (FE over existing data)

A view layer that re-presents the **same** task collection; no new task entity, only the new fields this PRD adds (`priority`, `dependsOn`, `milestoneId`, `completedAt`, `customFields`) enrich them:

- **List view** — a dense, sortable, filterable rows-of-tasks surface (group headers optional).
- **Table view** — a spreadsheet-style grid with **selectable columns**, including base fields, `priority`, `milestone`, and **custom-field** columns (§8). This is also the natural home for the long-missing **bulk-edit** affordance (`PUT /tasks/bulk` has no FE caller today) and inline cell edits.
- **Calendar view** — keyed by `startDate`/`dueDate` (the data that **exists but is currently unused** — §10.1). Tasks render on their due day (or span start→due); this finally surfaces `startDate`, which no view displays today.
- **Timeline / Gantt view** — bars from `startDate`→`dueDate` with **dependency edges** drawn from §4's `dependsOn`. (Without §4 the timeline shows bars only; the edges are what make it a Gantt.)
- **Swimlanes / grouping on the board** — group the existing board columns into horizontal lanes by **assignee**, **epic**, **priority**, or **milestone**. Pure presentation over the same task set; no schema change beyond the group key already existing on the task.

### 10.3 View layouts vs saved views (M5 boundary)

This PRD owns the **view layouts themselves** — the list/table/calendar/timeline renderers and the swimlane grouping. It does **not** own **persistence** of a named, shared view configuration (which filters + which columns + which grouping, saved and shared across a team): that is the **M5 "shared saved views"** feature and is deferred. Until M5, a view's configuration lives in URL/query state on the client; M5 later persists and shares it.

### 10.4 Backend changes the views require

The views cannot be FE-only — `GET /api/v1/tasks` must become **queryable and bounded**. Proposed additive query params (all optional; absent = today's behaviour, preserving the existing contract):

| Param                              | Effect                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `sortBy` / `sortDir`               | Sort by `index` (default), `priority` (derived rank, §3), `dueDate`, `startDate`, `createdAt`. |
| `priority`                         | Filter to a comma list of priority values (§3).                                          |
| `columnId` / `coordinatorId` / `labelId` / `milestoneId` / `epic` | Equality/`in` filters over the existing fields.                          |
| `assigneeId`                       | Membership filter against `assigneeIds`.                                                 |
| `dueBefore` / `dueAfter` / `startBefore` / `startAfter` | Date-range filters for the calendar/timeline windows.                  |
| `includeArchived` / `includeTrashed` | Opt back into archived/trashed rows (default excluded, §5.5).                          |
| `limit` / `cursor`                 | Pagination (the current list is unbounded).                                             |

To keep these efficient at non-trivial task counts, add **Mongo indexes** on `tasks`: `{projectId, index}` (existing default access), `{projectId, columnId}`, `{projectId, priority}`, `{projectId, dueDate}`, `{projectId, milestoneId}`, and `{projectId, deletedAt, archivedAt}` for the default-exclude predicate. These are additive (`ensure_indexes` in `database.py`); Rollout (§14) lists them. The query stays within the repository's filter contract; only the new range/`in` operators and pagination are introduced, scoped to this endpoint.

### 10.5 UX / surface

- A **view switcher** (Board / List / Table / Calendar / Timeline) in the project nav, board → first slot.
- A **group-by control** for board swimlanes.
- The **table view** carries the first real **multi-select + bulk-edit** UI, wired to `PUT /tasks/bulk`.

### 10.x Current state — 🔧/⬜ Planned

Only the kanban board exists; the **data substrate is partly present** (🔧 — `startDate`/`dueDate`/`assigneeIds` exist but are unused on most axes), while the views, swimlanes, and the queryable/paginated `GET /tasks` are all unbuilt (⬜).

---

## 11. AI-Assisted Work-Management

### 11.1 Current state

The AI substrate is real but **none of the work-management assists exist**. The agent framework, autonomy model, FE↔BE `interrupt()` tool contract, and the server-authoritative mutation journal are all in place ([`v2.1-agent.md`](v2.1-agent.md)). Embedding/similarity infra exists today: the task-estimation agent surfaces a `similar` top-3 over FE-supplied tasks via `jaccard`/`token_set` and optional embedding neighbours (`catalog/task_estimation.py:67-96`), with opt-in pgvector `task_embeddings` (`AGENT_VECTOR_SEARCH_ENABLED`, default off; otherwise a deterministic SHA-256 stub embedder). But there is **no** priority assist, **no** dependency assist, and **no** duplicate-detection/merge surface anywhere.

### 11.2 Proposed — three suggest-only assists, one framework

This section **consolidates** the AI hooks introduced by the feature sections; it is **not a new agent runtime**. All three are server-owned, **suggest-only**, and governed by the **existing autonomy model**. Each reads the FE-supplied snapshot via the existing `interrupt()` payload, emits a `{kind:"suggestion", surface, payload}` event, and writes **only** through the standard task endpoints **after user acceptance**, recorded in the existing mutation journal. No model identifier is exposed; no autonomy level beyond what [`v2.1-agent.md`](v2.1-agent.md) already defines is introduced.

- **Auto-prioritisation** (§3.3) — `surface:"priority"`; proposes a `priority` per task from due-date proximity, type, staleness, and blocking-edge count.
- **Dependency suggestions** (§4.4) — `surface:"dependency"`; proposes likely `dependsOn` edges from epic/milestone co-membership and title/`note` token overlap; cycle-introducing candidates are filtered server-side before surfacing.
- **Duplicate-task detection / merge** — `surface:"duplicate"`; **reuses the existing similarity infra** (`catalog/task_estimation.py:67-96` `jaccard`/`token_set` over the FE corpus, plus the optional pgvector `task_embeddings` neighbours when `AGENT_VECTOR_SEARCH_ENABLED` is on) to find near-duplicate tasks and propose a **merge** (keep one, fold the other's labels/assignees/`dependsOn` into it, then soft-delete the duplicate via §5). Acceptance executes through `PUT /tasks` + the soft-`DELETE` path and is journaled; the assist never merges autonomously.

### 11.3 What this is not

No new agent process, no new transport, no new autonomy dial (the four-level dial is explicitly out of scope), no inline `/copilot` slash command, no AI-driven drag-and-drop, no client-side memory or redaction. The "plan this sprint" milestone-filling AI is **M8** and is **not** part of these assists.

### 11.x Current state — 🟡 Partial

The similarity/embedding substrate exists (`catalog/task_estimation.py:67-96`, optional pgvector), but there is **no** priority, dependency, or duplicate surface — the assists themselves are unbuilt.

---

## 12. Acceptance Criteria

Proposed-feature invariants. An independent reviewer can ground each "Current state" clause against the cited source and each "must" against the new endpoint/collection it names.

| ID     | Acceptance criterion                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-W1  | `tasks.priority` accepts only `none/low/medium/high/urgent` (default `none`); any other value → `"Bad request"` (400). (`TABLE_FIELDS[tasks]`, `task_service.py` `_priority_error`) |
| AC-W2  | `priority` is settable via `PUT /api/v1/tasks/` and via `PUT /api/v1/tasks/bulk` (joined to `_BULK_CHANGE_FIELDS`), still `editor`-gated on every task's project and all-or-nothing on validation. (`task_service.py:39`) |
| AC-W3  | The auto-prioritisation assist is suggest-only: it emits a `surface:"priority"` suggestion and writes a priority **only** through the task endpoints after acceptance, journaled — never directly. (cross-ref `v2.1-agent.md`) |
| AC-W4  | `tasks.dependsOn` is a same-project task-id list; self-dependency and any **cycle-introducing** edge are rejected with `"Bad request"`; `blockedBy` is **derived** (inverse), never stored. (`TABLE_FIELDS[tasks]`, `task_service.py` `_depends_on_error`) |
| AC-W5  | `dependsOn` is **excluded** from `_BULK_CHANGE_FIELDS` and is distinct from `parentTaskId` (one-level sub-task containment). (`task_service.py`) |
| AC-W6  | Moving a task with unfinished prerequisites into a `category=="done"` column is gated (`"Bad request"`) unless `force:true`, and the gate is project-disable-able (`enforceDependencyGate`). (`task_service.py`, `PUT /api/v1/tasks/orders`) |
| AC-W7  | `columns.category` accepts only `todo/in_progress/done` (defaults seeded by `column_seed.py`) and becomes the **source of truth** for done-ness, replacing the name/`isDone` heuristic. (`TABLE_FIELDS[columns]`, `be_tools.py:324-330`) |
| AC-W8  | A task gains `completedAt` (server-set on entering / cleared on leaving a `done` column), and `archivedAt`/`deletedAt`; none are client-writable for `completedAt`. (`TABLE_FIELDS[tasks]`) |
| AC-W9  | `DELETE /api/v1/tasks/` and `DELETE /api/v1/projects/` **soft-delete by default** (set `deletedAt`) and require `?purge=true` for the legacy hard delete/cascade. (`task_service.py`, `project_service.py`) |
| AC-W10 | `PUT /api/v1/tasks/restore` and `PUT /api/v1/projects/restore` clear `deletedAt`/`archivedAt`; project restore is **manager-only**, task restore is `editor`. (new endpoints) |
| AC-W11 | `GET /api/v1/tasks` and `GET /api/v1/projects` **exclude** trashed/archived rows by default; `includeTrashed`/`includeArchived` opt back in. (`task_service.py:203-244`, `project_service.py`) |
| AC-W12 | `tasks.recurrence` validates **shape only** (`freq` enum, positive `interval`/`count`, in-range `byweekday`, `until`-xor-`count`) → `"Bad request"` otherwise. (`TABLE_FIELDS[tasks]`, `task_service.py` `_recurrence_error`) |
| AC-W13 | Recurring-task instantiation is performed by a **new background scheduler worker** (none exists today) and writes occurrences through the same repository + `validate_fields` allowlist, honouring `until`/`count`. (new worker; `repositories.py`) |
| AC-W14 | The `templates` collection stores `{kind, name, payload}`; `POST /api/v1/templates/instantiate` seeds a task (`editor`) or a **new project** (authenticated, caller=manager) from the payload **instead of** the fixed `column_seed` defaults. (`templates`, `column_seed.py`) |
| AC-W15 | `customFieldDefs` defines `{key,label,type∈text|number|select|date|checkbox,options?}` per project; `select` requires `options`; def CRUD is `owner`-gated. (`TABLE_FIELDS[customFieldDefs]`) |
| AC-W16 | `tasks.customFields` is added as **one** allowlisted nested map; the repository allowlist still rejects unknown **top-level** task keys, while the service validates the map **shape** (known def keys + per-type value check), not each dynamic key. (`repositories.py` `validate_fields`, `task_service.py` `_custom_fields_error`) |
| AC-W17 | Deleting a `customFieldDefs` definition cascade-strips that key from every same-project task's `customFields`, and a def's `type`/`key` cannot be changed on `PUT`. (`/api/v1/custom-fields/`) |
| AC-W18 | The `milestones` collection stores `{name,startDate,endDate,goal,status}`; `tasks.milestoneId` is same-project validated; delete cascade-clears `milestoneId`. (`TABLE_FIELDS[milestones]`, `TABLE_FIELDS[tasks]`) |
| AC-W19 | Milestone read returns a basic `{total, done}` count only; velocity/burndown analytics (M6) and "plan this sprint" AI (M8) are **not** in this layer. (cross-ref M6/M8) |
| AC-W20 | `GET /api/v1/tasks` gains optional `sortBy/sortDir`, field/date filters, and `limit/cursor` pagination; absent params reproduce today's `index`-sorted full list (backward-compatible). (`task_service.py:203-244`) |
| AC-W21 | New `tasks` Mongo indexes (`{projectId,columnId}`, `{projectId,priority}`, `{projectId,dueDate}`, `{projectId,milestoneId}`, `{projectId,deletedAt,archivedAt}`) back the view filters. (`database.py` `ensure_indexes`) |
| AC-W22 | The alternate views are an FE layer over the **same** task collection; **saved-view persistence is deferred to M5** — this layer ships the layouts, not the shared registry. (cross-ref M5) |
| AC-W23 | Duplicate-detection reuses the **existing** similarity infra (`jaccard`/`token_set` + optional pgvector) and proposes a merge that is executed only on acceptance via the task + soft-delete endpoints. (`catalog/task_estimation.py:67-96`) |
| AC-W24 | All three AI assists (priority, dependency, duplicate) are suggest-only, governed by the **existing** autonomy model, and add **no** new agent runtime. (cross-ref `v2.1-agent.md`) |

---

## 13. Open Questions

| ID    | Question                                                                                                                                                   | Leaning                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| OQ-W1 | Should `priority` and `dependsOn` participate in the AI **drift** signals (e.g. "urgent task is blocked")?                                                  | Yes — surface as a triage nudge in §11; cheap and high-signal.                                  |
| OQ-W2 | Is the dependency move-to-done gate a **hard** block or a **warn + override**?                                                                              | Warn + `force:true` override (§4.3), project-disable-able; hard blocks frustrate edge cases.    |
| OQ-W3 | What is the trash retention window, and who may purge early?                                                                                                | 30 days; `editor` may purge a task early, manager may purge a project early (§5.4).             |
| OQ-W4 | Embedded scheduler (APScheduler in-process) vs a separate worker process for §6?                                                                            | Start embedded for simplicity; design the job interface so it can move out without rework.      |
| OQ-W5 | Do recurrence rules need `monthly`-by-month-day vs by-weekday-ordinal (e.g. "3rd Friday")?                                                                  | v1 ships `daily/weekly/monthly` + `byweekday`; ordinal-monthly is a follow-up if asked.         |
| OQ-W6 | Should custom-field **values** be queryable in `GET /tasks` filters (not just displayable)?                                                                 | Defer — equality on a `select`/`checkbox` key is feasible but needs a sparse index; v1 displays/groups only. |
| OQ-W7 | Are templates project-scoped only, or org-shared?                                                                                                           | Project-scoped in this layer (N4); org-level template sharing rides the M5 cross-project work.  |
| OQ-W8 | Should `milestoneId` and `epic` converge (milestone supersedes the free-string epic)?                                                                       | Keep both for now — `epic` stays a free grouping string; `milestoneId` is the dated entity (§9).|

---

## 14. Rollout & Dependencies

| Item                                   | Dependency / sequencing                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`TABLE_FIELDS` allowlist relaxation** | **Required for custom fields (§8).** Add `customFields` as **one** allowlisted nested map on `tasks` and move dynamic-key validation into the service (`task_service.py` `_custom_fields_error`); the repository allowlist (`repositories.py` `validate_fields`) still gates all other keys. This is the single architectural change of this PRD — land it behind tests before exposing the field. |
| **New background-scheduler worker**     | **Required for recurring tasks (§6); new operational surface — none exists today.** Stand up the scheduler (embedded APScheduler or a worker process), make jobs idempotent under multiple workers, handle missed-tick catch-up. It also hosts the §5.4 trash-purge sweep and the future v2.1 triage-drift sweep — i.e. it is the **shared scheduling substrate**, not recurrence-only. |
| **New Mongo indexes on `tasks`**        | **Required for the alternate views (§10).** Add `{projectId,columnId}`, `{projectId,priority}`, `{projectId,dueDate}`, `{projectId,milestoneId}`, `{projectId,deletedAt,archivedAt}` to `database.ensure_indexes`; additive and safe to ship ahead of the views. |
| **New `GET /tasks` query params**       | **Required for the alternate views (§10) and the §5.5 default-exclude.** Optional `sortBy/sortDir`, field/date filters, `includeArchived`/`includeTrashed`, `limit/cursor`; absent params must reproduce today's behaviour (`task_service.py:203-244`) so existing clients are unaffected. |
| **Persisted done-category (§5.2)**      | **Prerequisite of §4.3 (dependency gate) and §6 (`on_complete` recurrence) and §9 (`{done}` count).** Land `columns.category` + the `be_tools._is_done_column` source-of-truth swap first; everything that means "done" depends on it. |
| **New collections**                     | `templates`, `customFieldDefs`, `milestones` — each a new `TABLE_FIELDS` entry, new thin router → service → `MongoRepository`, same sentinel→HTTP convention; no change to the repository contract beyond adding the table. |
| **Deferred to M5**                      | Shared **saved views** persistence/registry (this layer ships the view *layouts* only, §10.3); cross-project search/templates.                          |
| **Deferred to M6**                      | All reporting/velocity/burndown/cycle-time/WIP/throughput dashboards (this layer emits `priority`/`completedAt`/milestone `{total,done}` data only; `reports.tsx` stays a placeholder until then). |
| **Deferred to M7 / M8**                 | Real-time push of scheduler-created occurrences and trash changes (M7 SSE); autopilot lanes and the "plan this sprint" milestone-filling AI (M8).        |
| **Out of scope (not proposed)**         | MCP, voice, CRDT/Yjs co-editing, four-level autonomy dial, configurable end-user prompts, AI drag-and-drop, inline `/copilot` slash commands, client-side memory/redaction, 24h drawer undo (replaced here by server-persisted trash + restore). |

---

## Appendix A — Endpoint reference

New / changed endpoints only. All require a valid REST JWT (per [`core-collaboration.md`](core-collaboration.md) §3.1); the **Required role** column is the additional per-resource altitude, enforced via `can_access` and mapped to HTTP through the sentinel convention (`"Bad request"`→400, `"Forbidden"`→403, `"...not found"`→404).

| Method   | Path                                | Required role               | Purpose                                                                          |
| -------- | ----------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `PUT`    | `/api/v1/tasks/` *(changed)*        | `editor` (both projects)    | Now also writes `priority`, `dependsOn`, `recurrence`, `milestoneId`, `customFields`, archive/complete state. |
| `PUT`    | `/api/v1/tasks/bulk` *(changed)*    | `editor` (every task)       | `priority` joins the editable set; `dependsOn`/`recurrence`/routing fields stay excluded. |
| `PUT`    | `/api/v1/tasks/orders` *(changed)*  | `editor`                    | Move now sets/clears `completedAt` and applies the §4.3 dependency gate (`force:true` override). |
| `DELETE` | `/api/v1/tasks/` *(changed)*        | `editor`                    | **Soft-delete** (`deletedAt`) by default; `?purge=true` for the legacy hard delete. |
| `GET`    | `/api/v1/tasks/` *(changed)*        | `viewer`                    | Gains `sortBy/sortDir`, field/date filters, `includeArchived/includeTrashed`, `limit/cursor`. |
| `PUT`    | `/api/v1/tasks/restore`             | `editor`                    | Clear `deletedAt`/`archivedAt` on a task.                                        |
| `PUT`    | `/api/v1/tasks/archive`             | `editor`                    | Set/clear a task's `archivedAt`.                                                 |
| `POST`   | `/api/v1/boards/` *(changed)*       | `editor`                    | Column create now accepts `category` (`todo/in_progress/done`).                  |
| `PUT`    | `/api/v1/boards/` *(changed)*       | `editor`                    | Column update now writes `category`.                                             |
| `DELETE` | `/api/v1/projects/` *(changed)*     | manager-only                | **Soft-delete** (`deletedAt`) by default; `?purge=true` for the legacy cascade.  |
| `GET`    | `/api/v1/projects/` *(changed)*     | `viewer`                    | Excludes archived/trashed projects by default; `includeArchived/includeTrashed` opt in. |
| `PUT`    | `/api/v1/projects/restore`          | manager-only                | Clear a project's `deletedAt`/`archivedAt`.                                       |
| `PUT`    | `/api/v1/projects/archive`          | manager-only                | Set/clear a project's `archivedAt`.                                              |
| `GET`    | `/api/v1/templates/`                | `viewer`                    | List a project's templates (or one by `?templateId`).                            |
| `POST`   | `/api/v1/templates/`                | `editor`                    | Create a project/task template.                                                  |
| `PUT`    | `/api/v1/templates/`                | `editor`                    | Update a template.                                                               |
| `DELETE` | `/api/v1/templates/`                | `editor`                    | Delete a template (`?templateId`).                                               |
| `POST`   | `/api/v1/templates/instantiate`     | `editor` (task) / auth (project) | Materialise a template — seed a task, or a new project (caller=manager).     |
| `GET`    | `/api/v1/custom-fields/`            | `viewer`                    | List a project's custom-field definitions.                                       |
| `POST`   | `/api/v1/custom-fields/`            | `owner`                     | Create a field definition (`select` requires `options`).                         |
| `PUT`    | `/api/v1/custom-fields/`            | `owner`                     | Update `label`/`options`/`index` (not `type`/`key`).                             |
| `DELETE` | `/api/v1/custom-fields/`            | `owner`                     | Delete a definition; cascade-strip its key from tasks.                           |
| `GET`    | `/api/v1/milestones/`               | `viewer`                    | List a project's milestones (or one by `?milestoneId`); read returns `{total,done}`. |
| `POST`   | `/api/v1/milestones/`               | `editor`                    | Create a milestone.                                                              |
| `PUT`    | `/api/v1/milestones/`               | `editor`                    | Update a milestone.                                                              |
| `DELETE` | `/api/v1/milestones/`               | `editor`                    | Delete a milestone; cascade-clear `milestoneId` on tasks.                         |

---

## Appendix B — Data model

New collections and changed `tasks` / `columns` fields. Stored per `repositories.py` `TABLE_FIELDS` and serialized by `database.py` (`password` stripped; `createdAt`/`updatedAt` repository-managed). **Bold** = new in this PRD. `customFields` is the one nested map whose dynamic keys are validated in the **service** layer (§8.2), not enumerated in the allowlist.

| Collection           | Fields                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks` *(changed)*  | `_id`, `taskName`, `coordinatorId`, `epic`, `columnId`, `note`, `type`, `projectId`, `storyPoints`, `index`, `startDate`, `dueDate`, `labelIds`, `assigneeIds`, `parentTaskId`, **`priority`** (`none/low/medium/high/urgent`), **`dependsOn`** (`[taskId]`; `blockedBy` derived), **`milestoneId`**, **`recurrence`** (`{freq,interval,byweekday?,until?\|count?}`), **`recurrenceParentId`**, **`customFields`** (`{<defKey>: value}`), **`checklist`** (`[{text,done}]`), **`completedAt`**, **`archivedAt`**, **`deletedAt`**, `createdAt`, `updatedAt` |
| `columns` *(changed)*| `_id`, `columnName`, `projectId`, `index`, `wipLimit`, **`category`** (`todo/in_progress/done`; `isDone` derived), `createdAt`, `updatedAt`                                                                              |
| `projects` *(changed)*| `_id`, `projectName`, `organization`, `managerId`, `memberIds` (`[{userId,role}]`), **`archivedAt`**, **`deletedAt`**, **`enforceDependencyGate`** (`bool`, default `true`), `createdAt`, `updatedAt`                  |
| **`templates`**      | `_id`, `projectId`, `kind` (`project/task`), `name`, `description`, `payload` (typed columns/labels/tasks or a single task incl. `checklist`), `createdAt`, `updatedAt`                                                  |
| **`customFieldDefs`**| `_id`, `projectId`, `key`, `label`, `type` (`text/number/select/date/checkbox`), `options` (`[str]`, required iff `select`), `index`, `createdAt`, `updatedAt`                                                           |
| **`milestones`**     | `_id`, `projectId`, `name`, `startDate`, `endDate`, `goal`, `status` (`planned/active/completed`), `createdAt`, `updatedAt`                                                                                             |

Unchanged core collections (`labels`, `comments`, `notifications`, `users`) are owned by [`core-collaboration.md`](core-collaboration.md) Appendix B and are not restated here.
