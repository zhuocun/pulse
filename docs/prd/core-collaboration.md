# PRD: Pulse Core — Collaboration & Work Management

| Field             | Value                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status            | Draft v1 — as-built. Documents the non-AI collaboration & work-management core (projects, RBAC, boards, tasks, labels, comments, notifications) shipped to `main`. Backend fully shipped; frontend coverage partial (see §10).        |
| Author            | Product / Engineering — as-built reconciliation                                                                                                                                                                                      |
| Last updated      | 2026-06-04                                                                                                                                                                                                                          |
| Target repository | `pulse` (frontend `src/`; backend `backend/`, FastAPI + MongoDB)                                                                                                                                                                    |
| Document scope    | the core collaboration & work-management layer — data model, HTTP API, authorization, and current FE coverage. Explicitly NOT the AI/Board Copilot layer (see the companion AI PRDs).                                                |
| Companion docs    | [`v2.1-agent.md`](v2.1-agent.md) (AI backend/wire contract), [`v3-ai-ux.md`](v3-ai-ux.md) (AI UX), [`../todo/product-done.md`](../todo/product-done.md), [`../todo/release-todo.md`](../todo/release-todo.md), [`../todo/ui-todo.md`](../todo/ui-todo.md), [`../api/backend.md`](../api/backend.md), [`../api/frontend.md`](../api/frontend.md) |

---

## 1. TL;DR / Overview

Pulse has shipped a complete, server-side collaboration & work-management core — multi-user projects with role-based access control, kanban boards with WIP limits, rich tasks (scheduling, labels, multiple assignees, sub-tasks), bulk edits, comments with @mentions, and a notification inbox. **None of this has a PRD home.** The two existing PRDs — [`v2.1-agent.md`](v2.1-agent.md) and [`v3-ai-ux.md`](v3-ai-ux.md) — are both scoped exclusively to the AI/Board Copilot layer (LangGraph agents, SSE transport, FE tool interrupts, AI UX). The collaboration layer that the AI sits *on top of* was never written down.

This document fills that gap. It is an **as-built** PRD: it describes what is actually in the tree at the merged-`main` state, not an aspiration. The two facts a reader must internalise up front:

1. **The backend is complete and consistent.** Every collaboration feature listed above is fully implemented in `backend/app/` behind a uniform authorization model, a single Mongo repository, and a per-table write allowlist. Nothing in §3–§9 is speculative on the server side.
2. **The frontend coverage is partial and uneven.** Some features are fully wired (notifications), some have read-only or chip-level UI (labels, project membership), some have a UI on one task surface but not the other (task richness — see §6.5), and some have *no* UI at all (comments, WIP-limit controls, member management, bulk edit). §10 is the honest, feature-by-feature map. Where a surface does not exist, this document says so plainly rather than implying it does.

The substrate this layer assumes — authentication, the user directory, and password handling — is documented in [`../api/backend.md`](../api/backend.md) and is referenced here only where it bears on authorization (see §2 and §3). It is not re-specified.

---

## 2. Context & Scope

### 2.1 Relationship to the AI PRDs

| Layer                          | Owning document                          | What it covers                                                                 |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Collaboration & work mgmt      | **this document**                        | Projects, RBAC, boards/columns, tasks, labels, comments, notifications        |
| AI backend / wire contract     | [`v2.1-agent.md`](v2.1-agent.md)         | LangGraph named agents, SSE transport, FE↔BE tool interrupts, autonomy        |
| AI UX                          | [`v3-ai-ux.md`](v3-ai-ux.md)             | AI surfaces, confidence UI, citations, mutation previews, onboarding          |

The relationship is strictly **substrate → consumer**. The AI agents read and write the very collections this document specifies (projects, columns, tasks), through the same data model. Two deliberate touch-points are called out where they matter:

- The **drift detector** (`be_tools.detect_drift`, an AI surface) honours the per-column `wipLimit` defined in §5. The WIP-limit *value* is owned by this layer; the AI only consumes it.
- The **Triage Inbox** of AI "nudges" ([`v2.1-agent.md`](v2.1-agent.md) §7.8, [`v3-ai-ux.md`](v3-ai-ux.md) §7.2) is a *different* feature from the **Notifications inbox** in §9, even though the FE hosts both in the same `inbox.tsx` page. §9 makes the disambiguation explicit so the two are never conflated.

Everything else about the AI layer — agents, streaming, proposals, undo — is out of scope here.

### 2.2 Goals & Non-goals

**Goals**

- **G1 — Document the shipped data model.** Every collection and field, as written to disk (Appendix B).
- **G2 — Document the shipped HTTP API.** Every non-AI endpoint, its path, its required role, and its behaviour (Appendix A + §3–§9).
- **G3 — Specify the authorization model precisely.** The role hierarchy, the manager root-of-trust, and the exact altitude required for every resource (§3).
- **G4 — Tell the truth about the frontend.** A single, auditable map of backend feature → FE status, including the surfaces that do not exist (§10).
- **G5 — Surface documentation debt.** Name the stale API docs that contradict the shipped behaviour so they can be reconciled (§13).

**Non-goals**

- **N1 — The AI/Board Copilot layer.** Owned by the companion PRDs.
- **N2 — Auth/identity internals.** Registration, login, token issuance, and password hashing are referenced but owned by [`../api/backend.md`](../api/backend.md).
- **N3 — Real-time / multi-client sync.** There is no WebSocket push for collaboration data; clients poll via React Query. (Notifications are read on demand, not streamed.)
- **N4 — Building the missing FE.** §12 lists the gaps; closing them is future work, not part of this as-built record.
- **N5 — Re-architecting persistence.** The single-tenant Mongo scan model (§3.4, §7) is described as-is; indexing/perf work is noted as an extension point, not specified.

### 2.3 Status legend

This legend is used consistently in every FE-status callout and in §10.

| Symbol | Meaning                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------- |
| ✅     | **Shipped** — backend complete AND a working, user-reachable FE surface exists.                  |
| 🟡     | **Partial** — backend complete; FE exists but is incomplete (read-only, chip-only, or one of two surfaces).|
| 🔧     | **Backend-only** — backend complete; NO FE surface (no hook, no component) consumes it.          |
| ⬜     | **Planned** — not built (noted only where a natural extension point exists).                     |

---

## 3. Roles & Access Control (RBAC)

All authorization for the collaboration layer lives in `project_service.py` and is enforced by every router via a shared FastAPI dependency. This section is the single source of truth for "who can do what."

### 3.1 Global request authorization

Every non-AI router depends on `current_user_payload` (`security.py`). The contract:

- A **missing or invalid JWT → `401`**. The token is read from the `Authorization: Bearer` header or, for browsers, the HttpOnly `Token` session cookie (`_extract_bearer`); header wins when both are present.
- A token whose scope is `ai_proxy` is **rejected with `401`** on these routes (`token_scope(payload) == JWT_SCOPE_AI_PROXY` ⇒ raise). AI-proxy tokens are accepted *only* by the AI routes (a separate dependency).
- The **caller's identity is the JWT `sub` claim** (`current_user_id`). It is never taken from a request body or query — see the anti-spoof patterns in §4.1 and §8.

### 3.2 Role model

Roles are **totally ordered**: `owner > editor > viewer`. A gate expressed as a minimum role passes for any role whose rank is ≥ the gate's rank.

```
ROLE_RANK = { "viewer": 1, "editor": 2, "owner": 3 }
VALID_ROLES = { "owner", "editor", "viewer" }
```

Membership is stored **inline** on the project document as `memberIds`: a list of `{ "userId": <str>, "role": <str> }` rows (`repositories.py` `TABLE_FIELDS[projects]`). `memberIds` is optional on read so legacy single-owner project docs still deserialize.

### 3.3 The manager as immutable root of trust

Each project has a `managerId`. The manager is an **owner-equivalent root of trust** with two special properties:

1. **Short-circuit access.** `can_access` returns owner-rank for the manager **even if `memberIds` is empty or missing** — `if str(project.get("managerId")) == str(user_id): return ROLE_RANK[ROLE_OWNER] >= threshold`. This preserves the legacy single-owner model and means a project is never lockable-out of its own creator.
2. **Immutable membership.** The manager's own membership entry **cannot be added, demoted, or removed** through the member endpoints. All three mutating member functions (`add_member`, `update_member_role`, `remove_member`) return `"Bad request"` when the target equals the `managerId`. Ownership transfer is a *separate* operation: it goes through `managerId` on `PUT /projects` (§4.1), not through the member roster.

The core predicates:

```python
can_access(project_or_doc, user_id, min_role=ROLE_VIEWER) -> bool
    # True iff user_id is the managerId, OR has a memberIds entry
    # whose role rank >= rank(min_role).

is_project_manager(project_id, user_id) -> bool
    # == can_access(project_id, user_id, ROLE_OWNER)
```

> **Subtlety worth noting:** `is_project_manager` is named for the manager but is implemented as an *owner-level* `can_access` check. So an ordinary member promoted to `owner` passes `is_project_manager` (e.g. they may moderate comments, §8). The two operations that demand the **strict** `managerId == caller` identity — project update and project delete — do **not** go through `is_project_manager`; they compare `managerId` directly (§4.1), so even another `owner` cannot perform them.

### 3.4 Authorization-altitude table

The required altitude for every collaboration resource. "Read" = `viewer`; "Write" = `editor`; "Admin" = `owner`; "Manager-only" = strict `managerId == caller`.

| Resource / action                                          | Required altitude            | Source                          |
| ---------------------------------------------------------- | ---------------------------- | ------------------------------- |
| GET project (single / list), GET members roster            | `viewer`                     | `project_service.py`            |
| GET board (columns)                                        | `viewer`                     | `board_service.py`              |
| GET tasks                                                  | `viewer`                     | `task_service.py`               |
| GET labels                                                 | `viewer`                     | `label_service.py`              |
| GET comments (per task)                                    | `viewer`                     | `comment_service.py`            |
| Column create / update / reorder / delete                  | `editor`                     | `board_service.py`              |
| Task create / update / delete / **bulk** / reorder         | `editor`                     | `task_service.py`               |
| Label create / update / delete                             | `editor`                     | `label_service.py`              |
| Comment **create**                                         | `viewer` ("participants too") | `comment_service.py`            |
| Comment **edit**                                           | **author only**              | `comment_service.py`            |
| Comment **delete**                                         | **author OR project manager**| `comment_service.py`            |
| Project member add / change-role / remove                  | `owner`                      | `project_service.py`            |
| Project **update** (`PUT`) — incl. ownership transfer      | **manager-only** (strict)    | `project_service.py`            |
| Project **delete** (`DELETE`)                              | **manager-only** (strict)    | `project_service.py`            |
| Own user profile read / update                             | **self only**                | `users.py` (substrate)          |
| Notification list / mark-read                              | **self only**                | `notification_service.py`       |

### 3.5 Sentinel → HTTP mapping

Services do not raise HTTP errors directly; they return **string sentinels** that routers map to status codes (helpers in `validation.py`). The convention is uniform across every router:

| Service sentinel                          | HTTP status | Notes                                                              |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------- |
| `"Bad request"` / field validation errors | `400`       | `validation_errors` / `api_error(400, …)`                         |
| `"Forbidden"`                             | `403`       | Caller lacks the required altitude.                               |
| `None` / `"... not found"`                | `404`       | Resource (or a referenced resource) does not exist.               |
| success string (e.g. `"Task created"`)    | `2xx`       | Returned verbatim as the response body.                           |

Writes additionally pass through a **per-table field allowlist** (`TABLE_FIELDS` in `repositories.py`): `validate_fields` rejects any unknown key before it reaches Mongo. And the serializer **strips `password`** from every document it returns (`database.py` `serialize_document`), so credentials never leave the server even if a user doc is read indirectly.

---

## 4. Projects & Membership

Prefix: `/api/v1/projects` (project CRUD) and `/api/v1/projects/members` (membership). Service: `project_service.py`; router: `projects.py`.

### 4.1 Project CRUD

| Method | Path  | Altitude       | Behaviour                                                                                                                              |
| ------ | ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/`   | authenticated  | Create. `managerId` is **derived from the JWT `sub`**, never the body (anti-confused-deputy). Seeds `memberIds=[{manager, "owner"}]` and the default columns. Requires `projectName`, `organization`. |
| `GET`  | `/`   | `viewer`       | List, or single by `?projectId`. Single → `"Forbidden"` if caller lacks `viewer`. List → filtered through `can_access(viewer)` in Python (§4.3). |
| `PUT`  | `/`   | **manager-only** | Update. Allowed fields `{projectName, organization, managerId}`. `memberIds` is **not** writable here. A `managerId` change is an ownership transfer, validated against `users` (→ `"Manager not found"`). |
| `DELETE`| `/`  | **manager-only** | Delete. Cascades **tasks → columns → project** (leaves-first ordering so a partial failure leaves a well-formed read-only project, not orphans). |

**Anti-spoof note:** on create, the body may *not* set the manager. The previous design accepted a `managerId` that had to equal the caller — pure attack surface with no upside — and it was removed. The creator is seeded as an `owner` member so authorization can reason about `memberIds` uniformly from day one (the manager short-circuit is then belt-and-suspenders).

### 4.2 Member CRUD

Prefix `/api/v1/projects/members`. All **mutations are `owner`-gated**; the roster read is `viewer`-gated.

| Method  | Path        | Altitude  | Behaviour                                                                                                       |
| ------- | ----------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/members`  | `viewer`  | Roster `[{ _id, username, email, role }]`. Skips dangling user refs (a member whose user was deleted).         |
| `POST`  | `/members`  | `owner`   | Add / upsert. Role must be valid; target user must exist; **idempotent** — re-adding an existing member updates their role. → `"Member added"`. |
| `PUT`   | `/members`  | `owner`   | Change role. → `"Member updated"` / `"Member not found"`.                                                       |
| `DELETE`| `/members`  | `owner`   | Remove (`?projectId=&userId=`). → `"Member removed"` / `"Member not found"`.                                    |

All three mutations refuse to touch the `managerId` row (§3.3): target == manager ⇒ `"Bad request"`.

### 4.3 Membership-filtered listing

`GET /projects` with no `projectId` returns only projects the caller can see. Because `memberIds` is an inline list (and the query contract these services follow is operator-free — no `$elemMatch`), the listing fetches the candidate set with a flat exact-match filter and applies `can_access(viewer)` **in Python**. A cross-tenant probe (`?managerId=<someone-else>`) short-circuits to `"Forbidden"` before any scan. An indexed `memberIds.userId` query is a future perf optimisation; at single-tenant scale the scan is acceptable.

### 4.4 Data model — `projects`

`_id`, `projectName`, `organization`, `managerId`, `memberIds` (`[{ userId, role }]`), `createdAt`, `updatedAt`.

### 4.5 Frontend status — ✅ Shipped (member management UI)

> **Update (M4):** the gap described below is now closed. A `Members`
> surface ships at `/projects/:projectId/members` (`ProjectMembersManager`
> + `useProjectMemberMutations`): it renders the roster with each member's
> `role`, and an owner can add members (from the global directory), change
> roles, and remove members. The manager (`managerId`) row is immutable in
> the UI (disabled controls + badge) mirroring the server invariant, and
> the whole surface is read-only for non-owners. The paragraph below
> documents the pre-M4 state for history.

- **No member-management UI exists.** `ProjectModal` (`src/components/projectModal/index.tsx`) has only name / organization / **manager picker** — no add / remove / change-role controls anywhere in the app. The manager picker is sourced from the **global** `useMembersList` (`GET /users/members`), not the project roster.
- **No Members tab.** The project-detail child nav (`src/pages/projectDetail.tsx`) is **Board + Reports only**.
- **The roster is read in exactly one place.** `useProjectMembers(projectId)` (`GET /projects/members`) feeds the **assignee picker** in the legacy `TaskModal`. `IProjectMember.role` is modeled but **never rendered** anywhere.
- **The board-header member popover is not the roster.** `MemberPopover` (`src/components/memberPopover/index.tsx`) shows `username` + `email` (no role) and reads the **global** `/users/members` directory, not the project's members.

Net: project membership and RBAC are fully enforced server-side, but the only way to manage members today is to call the API directly. See §12.

---

## 5. Boards & Columns

Prefix: `/api/v1/boards`. Service: `board_service.py` (+ `column_seed.py`); router: `boards.py`.

### 5.1 Endpoints

| Method  | Path       | Altitude  | Behaviour                                                                                                       |
| ------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/`        | `viewer`  | Columns sorted by `index`. Lazily seeds defaults if the project has none (§5.3).                               |
| `POST`  | `/`        | `editor`  | Create column. Requires `columnName`, `projectId`; optional `wipLimit` validated. New `index = count`; `wipLimit` default `0`. |
| `PUT`   | `/`        | `editor`  | Rename / set WIP. Allowed `{columnName, wipLimit}` (`projectId` / `index` **not** writable). Requires `_id`.    |
| `PUT`   | `/orders`  | `editor`  | Reorder. Same-project enforced; re-packs indices via `column_reorder_updates`.                                 |
| `DELETE`| `/`        | `editor`  | Delete (`?columnId=`). Deletes the column **and its tasks**, then re-packs sibling indices contiguously.        |

### 5.2 WIP-limit semantics

`wipLimit` is a **non-negative `int`** (`_wip_limit_error`). The validator mirrors `storyPoints`: `bool` is rejected explicitly (it is an `int` subclass), and floats/strings (`1.5`, `"5"`) are rejected as non-ints. **`0` means "no limit"** per the drift-detector contract (`be_tools.detect_drift`). Validation runs at the router *and* defensively in the service so a direct service caller cannot persist a malformed value.

### 5.3 Seeding & self-healing

`ensure_default_columns(project_id)` seeds `("To Do", "In Progress", "Done")` when a project has **no** columns. It runs both on **project create** and **lazily on board read/create**, so legacy projects that predate create-time seeding self-heal on first board access. (Note: the seeded column docs do not set `wipLimit`, which reads as "no limit" — consistent with `0`.)

### 5.4 Data model — `columns`

`_id`, `columnName`, `projectId`, `index`, `wipLimit`, `createdAt`, `updatedAt`.

### 5.5 Frontend status — 🟡 Partial (columns ✅, WIP control ❌)

- **Columns and ordering are fully built.** `ColumnCreator` (`src/components/columnCreator/index.tsx`), the column header, rename, delete, and drag-reorder all ship and work.
- **The WIP-limit control does not exist.** `IColumn.wipLimit` is modeled in the type but is referenced by **no component** (verified: the only `src/` reference is the interface itself). `ColumnCreator` posts only `{columnName, projectId}`; there is no WIP input on create or edit. The column header renders a plain task-count `Badge` (`filteredTasks.length`) with **no limit display and no overflow indicator**.

---

## 6. Tasks & Work Items

Prefix: `/api/v1/tasks`. Service: `task_service.py`; router: `tasks.py`. Tasks are the richest collection and carry the most FE divergence (§6.5).

### 6.1 Data model — `tasks`

| Field            | Notes                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| `_id`            |                                                                                   |
| `taskName`       | Required.                                                                         |
| `coordinatorId`  | **Primary assignee.** Must reference an existing user.                            |
| `epic`           | Free string. Default `""`.                                                        |
| `columnId`       | Must belong to the task's project.                                                |
| `note`           | Free string. Default `""`.                                                        |
| `type`           | Default `"Task"` (the FE offers `Task` / `Bug`).                                   |
| `projectId`      |                                                                                   |
| `storyPoints`    | Positive finite number. Default `1`.                                              |
| `index`          | Ordering-managed; never client-writable.                                          |
| `startDate`      | _Richness._ ISO date string (or `""`). Default `""`.                              |
| `dueDate`        | _Richness._ ISO date string (or `""`). Default `""`.                              |
| `labelIds`       | _Richness._ List of label `_id`. Default `[]`.                                    |
| `assigneeIds`    | _Richness._ **Additional** assignees beyond `coordinatorId`. Default `[]`.        |
| `parentTaskId`   | _Richness._ Sub-task → parent `_id` (or `None`). Default `None`. One level only.  |
| `createdAt` / `updatedAt` |                                                                          |

The first five "richness" fields (`startDate`, `dueDate`, `labelIds`, `assigneeIds`, `parentTaskId`) are the load-bearing distinction for §6.5.

### 6.2 Endpoints

| Method  | Path       | Altitude  | Behaviour                                                                                                                                  |
| ------- | ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/`        | `viewer`  | Tasks sorted by `index`. Seeds a `"Default Task"` if the project has columns but no tasks.                                                |
| `POST`  | `/`        | `editor`  | Create. Requires `projectId`, `columnId`, `taskName`; column must belong to project; `coordinatorId` must exist. Defaults per §6.1.       |
| `PUT`   | `/`        | `editor`  | Update. Gated on **both** the current and target project. Allowed = all fields **except** `index`/`_id`. Re-validates column↔project + coordinator; `parentTaskId` re-validated (§6.4). |
| `DELETE`| `/`        | `editor`  | Delete (`?taskId=`). **Orphans** sub-tasks to top-level (does NOT cascade-delete children); re-packs indices.                             |
| `PUT`   | `/bulk`    | `editor`  | Fan-out metadata edit (§6.2.1).                                                                                                           |
| `PUT`   | `/orders`  | `editor`  | Reorder within / across columns. Same-project; column-membership consistency enforced.                                                   |

#### 6.2.1 Bulk update

`PUT /tasks/bulk` body `{ taskIds: [...], changes: {...} }`. The editable subset is **all updatable fields EXCEPT `columnId` & `projectId`** (`_BULK_CHANGE_FIELDS`): positional/routing moves must go through `/orders` or a single `update` where index re-packing and project re-validation happen. Unknown / disallowed keys in `changes` are **silently dropped**, so a client may send a wider patch object and trust the server to keep only the safe fields.

It is `editor`-gated on **every** task's project **before any write** — a forbidden member cannot slip an edit onto the tasks they happen to control. It is **all-or-nothing on validation**: a single unknown id fails the whole batch (`404`) before anything is written, and the same metadata / `storyPoints` / coordinator / parent-task invariants the single-task path enforces are re-run on the change set. → `"Tasks updated"`.

### 6.3 Validation rules

| Field                       | Rule                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `storyPoints`               | Positive **finite** number. Rejects `bool`, `NaN`/`Infinity`, and `<= 0`.                          |
| `startDate` / `dueDate`     | When present and non-empty, must be a **string**. **No calendar parsing** — the edge owns format. |
| `labelIds` / `assigneeIds`  | Must be a **list of strings** when sent.                                                           |
| `parentTaskId`              | Must **exist**, be **same-project**, and **not be self** (§6.4).                                   |
| `taskName` (update)         | Non-empty string when present.                                                                     |

### 6.4 Sub-tasks (`parentTaskId`)

A task may point at a parent via `parentTaskId`. The validator (`_parent_task_error`) enforces: the parent must exist, must live in the **same project** as the child, and must **not be the child itself**. Clearing the parent (`None`/`""`) is always allowed. The check stops at the self-reference guard rather than walking an ancestor chain — **one level of nesting is the design**, sufficient for the board. On delete, a parent's children are **orphaned to top-level**, never cascade-deleted (§6.2), so deleting a parent never wipes a whole branch out from under the user.

### 6.5 Frontend status — 🟡 Partial (the TaskModal vs TaskDetailPanel divergence)

There are **two** task-editing surfaces, selected by the `environment.taskPanelRouted` flag (`src/constants/env.ts`), which **defaults OFF (opt-in)**. This is the single most important honesty point in this document:

| Surface                | Mounted when                     | Renders the 5 richness fields? |
| ---------------------- | -------------------------------- | ------------------------------ |
| `TaskModal` (legacy)   | `taskPanelRouted` **OFF** (default) | **Yes** — all five.            |
| `TaskDetailPanel` (routed) | `taskPanelRouted` **ON**         | **No** — none of the five.     |

- **`TaskModal`** (`src/components/taskModal/index.tsx`) renders **all** richness fields as editable form items: `startDate`/`dueDate` `DatePicker`s, `labelIds` multi-`Select` with colour chips, `assigneeIds` multi-`Select`, and a clearable `parentTaskId` `Select`. Its assignee options come from `useProjectMembers` (the project roster); its label options from `useLabels`.
- **`TaskDetailPanel`** (`src/components/taskDetailPanel/index.tsx`) renders **only** `taskName` / `coordinatorId` / `type` / `epic` / `storyPoints` / `note` (its `TASK_PANEL_FIELDS` array). It has **none** of the five richness fields. **Verified against source.** Because `taskPanelRouted` defaults OFF, the legacy modal is the live experience today — but anyone who flips the flag silently loses the ability to edit dates, labels, additional assignees, and sub-task parentage from the task surface.

Card rendering (`src/components/column/index.tsx`, `TaskCard`):

- **Label chips** render from `labelIds` (threaded board → column → card; unknown ids dropped).
- An **overdue chip** renders from `dueDate` (date-only "strictly before today" rule, paired with a glyph + visible "Overdue" text + aria-label — not colour-only).
- The card **avatar still uses the single `coordinatorId`**, not `assigneeIds`. There is **no sub-task hierarchy view** on cards, and the count badge has no WIP signal (§5.5).

Bulk edit: **there is no board-level bulk-edit / multi-select UI.** The only thing resembling "bulk" in the app is the AI subtask **batch-create** in `aiTaskDraftModal` — a different feature in a different layer, and it posts tasks individually rather than through this endpoint. `PUT /tasks/bulk` itself has **no FE caller at all**.

---

## 7. Labels

Prefix: `/api/v1/labels`. Service: `label_service.py`; router: `labels.py`.

### 7.1 Endpoints

| Method  | Path  | Altitude  | Behaviour                                                                                                       |
| ------- | ----- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/`   | `viewer`  | List the project's labels (`?projectId`).                                                                       |
| `POST`  | `/`   | `editor`  | Create. Requires `projectId`, `name`; `color` defaults `"#888888"`; non-string `name`/`color` → `"Bad request"`. → `"Label created"`. |
| `PUT`   | `/`   | `editor`  | Update `name` / `color`. Allowed `{name, color}` (`projectId` immutable).                                       |
| `DELETE`| `/`   | `editor`  | Delete (`?labelId=`). **Cascade-strips** the id from every same-project task's `labelIds`.                      |

### 7.2 Cascade-on-delete

Deleting a label removes it **and** strips its id from every task in the same project that referenced it, so the board never renders a dangling chip. Because the query contract is operator-free, the service fetches the project's tasks with a flat filter and rewrites each affected `labelIds` in Python.

### 7.3 Data model — `labels`

`_id`, `projectId`, `name`, `color`, `createdAt`, `updatedAt`.

### 7.4 Frontend status — 🟡 Partial (chips only)

- **Label chips render on cards** (board → column → card; §6.5).
- **There is no label-management UI.** `useLabels.createLabel` exists in the hook but has **ZERO UI callers** (verified — referenced only by the hook definition and its test). Nothing wires edit or delete. There is **no labels page, modal, or settings surface**. Labels can be read and applied (via the `TaskModal` picker) but can only be *created/edited/deleted* by calling the API directly. See §12.

---

## 8. Comments & @Mentions

Prefix: `/api/v1/comments`. Service: `comment_service.py`; router: `comments.py`.

### 8.1 Endpoints

| Method  | Path  | Altitude                  | Behaviour                                                                                                       |
| ------- | ----- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/`   | `viewer` (on task's project) | List a task's comments oldest-first (`?taskId`).                                                             |
| `POST`  | `/`   | `viewer` ("participants too") | Create + notify mentions. Requires `taskId`, `body`. → `"Comment created"`.                                 |
| `PUT`   | `/`   | **author only**           | Edit `body` only. Mentions are **not** re-processed on edit (§8.3).                                             |
| `DELETE`| `/`   | **author OR project manager** | Delete (`?commentId`). Ordinary members (non-author) cannot delete others' comments.                        |

### 8.2 Anti-spoof: `projectId` is derived from the task

On create, `projectId` is taken **from the task**, not the request body — a client cannot file a comment under a project the task does not belong to. `viewer`-level access on that derived project is sufficient to comment ("viewers are participants too").

### 8.3 Mention → notification fan-out

Mentions are supplied as an explicit **list in the request body** — they are **not parsed from the body text server-side**. Each is normalised to a `userId` string and stored as `mentions` on the comment. The producer then fans out a `"mention"` notification for each **unique** mention, but **only if** the target (a) exists in `users`, (b) `can_access(project, viewer)` (i.e. is a member), and (c) is not the author. Ids failing any check are **skipped silently** — a typo'd, non-member, or self mention is a no-op, never an error, so a bad mention never fails the comment write. The notification summary is `"{authorId} mentioned you"` and its `refId` is the **taskId**. Because edits do not re-process mentions, recipients are never re-spammed on an edit.

### 8.4 Data model — `comments`

`_id`, `taskId`, `projectId`, `authorId`, `body`, `mentions`, `createdAt`, `updatedAt`.

### 8.5 Frontend status — 🟡 Partial (comments UI on the legacy task surface)

> **Update (M4):** a comment thread now ships. `useComments` +
> `CommentsThread` (list / create / edit / delete) are mounted in
> `TaskModal` (the live, default task surface): viewers can comment,
> authors can edit their own comment, and the author or a project owner
> can delete. A mention multi-select lets the author notify project
> members; a mention-bearing create invalidates the notifications query,
> so the §9 bell badge now has a real producer. Still open: the routed
> `TaskDetailPanel` does not yet host the thread. The paragraph below
> documents the pre-M4 state for history.

There is **no comment UI of any kind.** The `IComment` interface exists, but there is **no `useComments` hook** and **no comment component** (verified). Neither task surface (`TaskModal`, `TaskDetailPanel`) renders a comment thread. Comments — and therefore @mention notifications — can only be created today by calling the API directly. (Note: when a mention notification *is* produced by some client, the **notifications inbox in §9 does render it** — the consumer side is wired even though the producer side has no UI.)

---

## 9. Notifications

Prefix: `/api/v1/notifications`. Service: `notification_service.py`; router: `notifications.py`.

### 9.1 Inbox model

Notifications are **strictly user-scoped**: a row belongs to exactly one recipient (`userId`), and *being the addressee is the entire permission model*. There is no project-level authorization on a notification.

| Method | Path | Altitude   | Behaviour                                                                                                       |
| ------ | ---- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/`  | self only  | The caller's **own** notifications, newest-first. **No query params** — a caller can never request another user's inbox. |
| `PUT`  | `/`  | self only  | Mark read. `{markAll:true}` flips all the caller's unread; `{_id}` flips one. A notification not owned by the caller → `"Forbidden"`; missing `_id` → `"Bad request"`; nonexistent row → `404`. |

The single-id mark-read path is the **only** cross-user guard, and it is deliberately strict: a foreign notification is `"Forbidden"` (it exists, the caller just may not touch it), not `404`.

### 9.2 Kinds & the producer

There is **no `POST` endpoint**. Notifications are produced by an **internal** helper only:

```python
notification_service.create(user_id, kind, ref_id, summary, project_id=None)
    # isRead starts False.
```

`kind` is **free-form and built to extend**, but the **only kind produced today is `"mention"`** (from comment mentions, §8.3). The `projectId` is optional so future non-project kinds can reuse the same producer.

### 9.3 Data model — `notifications`

`_id`, `userId`, `kind`, `refId`, `projectId`, `summary`, `isRead`, `createdAt`, `updatedAt`.

### 9.4 Disambiguation: this is NOT the AI "Triage Inbox"

This must not be conflated with the AI **Triage Inbox** of *nudges* ([`v2.1-agent.md`](v2.1-agent.md) §7.8 / [`v3-ai-ux.md`](v3-ai-ux.md) §7.2 — the cap-5, 4h-expiry, board-scoped drift suggestions). They are different features with different storage and different lifecycles. The FE `inbox.tsx` page happens to **host both**: it renders a (currently structurally-empty) **Triage** section *and* the **Mentions** section backed by *these* notifications, plus a session-only **Activity** section (`useActivityFeed`, not server-backed). Readers should keep the three straight:

| Inbox section | Backed by                              | Layer            |
| ------------- | -------------------------------------- | ---------------- |
| Triage        | AI drift nudges (board-scoped)         | AI PRDs          |
| Mentions      | `notifications` where `kind=="mention"`| **this document**|
| Activity      | `useActivityFeed` (session-only, client)| FE-only          |

### 9.5 Frontend status — ✅ Shipped

The notification surface is **fully wired**:

- `notificationBell` (`src/components/notificationBell/index.tsx`) — badge trigger + drawer — is mounted in the header.
- The Inbox page (`src/pages/inbox.tsx`) has a **Mentions** section filtering `kind === "mention"` and deep-linking to the referenced task's **project board** (`/projects/{projectId}/board`; the routed task deep-link is flag-gated, the board is not).
- Mark-read per row, mark-all, and auto-mark-all-on-view are all implemented.
- `useNotifications` (`src/utils/hooks/useNotifications.ts`) derives `unreadCount` from `!isRead` and exposes `markRead({_id})` / `markAllRead({markAll:true})`.

This is the one collaboration feature whose consumer FE is complete — even though its sole *producer* (comment mentions, §8) has no UI yet.

---

## 10. Frontend Coverage Status

The single, auditable map. Legend per §2.3.

| Backend feature                          | FE status | Surface (or its absence)                                                                 |
| ---------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| Project CRUD                             | ✅        | `ProjectModal` (create/edit name·org·manager); project list; project-detail shell.       |
| Ownership transfer (`PUT managerId`)     | 🟡        | Manager picker exists in `ProjectModal` edit; no dedicated transfer flow.                |
| Project member roster (read)             | ✅        | `ProjectMembersManager` renders the roster + `role`; also read by the `TaskModal` assignee picker. |
| Project member add/change-role/remove    | ✅        | `ProjectMembersManager` at `/projects/:projectId/members` (owner-gated add / change-role / remove; manager row immutable; read-only for non-owners). |
| Columns: create/rename/delete/reorder    | ✅        | `ColumnCreator`, column header, drag-reorder.                                             |
| Column WIP limit (`wipLimit`)            | 🔧        | **No control.** Modeled in `IColumn`; referenced by no component. Plain count badge only.|
| Task CRUD (base fields)                  | ✅        | `TaskModal` and `TaskDetailPanel`; cards; inline title rename.                            |
| Task richness (dates/labels/assignees/parent) | 🟡   | `TaskModal` only (full). `TaskDetailPanel` renders **none** of them (§6.5).               |
| Task labels — chips on cards             | ✅        | `TaskCard` label chips.                                                                   |
| Task overdue — chip on cards             | ✅        | `TaskCard` overdue chip (from `dueDate`).                                                 |
| Additional assignees on cards            | 🔧        | Cards show only the single `coordinatorId` avatar; `assigneeIds` not surfaced.           |
| Sub-task hierarchy view                  | 🔧        | Parent is editable in `TaskModal`; no hierarchy/tree view on cards or elsewhere.         |
| Task bulk update (`PUT /tasks/bulk`)     | 🔧        | **No UI.** No board multi-select; endpoint has no FE caller at all.                       |
| Labels — list + apply                    | 🟡        | Read via `useLabels`; applied via `TaskModal` picker; chips on cards.                     |
| Labels — create/edit/delete UI           | 🔧        | **No UI.** `createLabel` has zero callers; no labels page/modal.                          |
| Comments (CRUD + thread)                 | 🟡        | `useComments` + `CommentsThread` (list/create/edit/delete) mounted in `TaskModal` (legacy surface); not yet on the routed `TaskDetailPanel`. |
| @mentions (producer)                     | ✅        | Mention multi-select in `CommentsThread`; a mention-bearing create invalidates the notifications query so the bell badge refreshes.                                          |
| Notifications inbox (consumer)           | ✅        | `notificationBell` + `inbox.tsx` Mentions section + `useNotifications`.                   |

---

## 11. Acceptance Criteria

As-built invariants. An independent reviewer can ground each against the cited source.

| ID     | Acceptance criterion                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-C1  | Every non-AI route rejects a missing/invalid JWT with `401`, and rejects an `ai_proxy`-scoped token with `401`. The caller id is the JWT `sub`. (`security.py`)        |
| AC-C2  | Roles are totally ordered `owner(3) > editor(2) > viewer(1)`; a `min_role` gate passes iff the caller's rank ≥ the gate's rank. (`project_service.py`)                 |
| AC-C3  | `can_access` returns owner-rank for `managerId == caller` **even when `memberIds` is empty/missing**. (`project_service.py`)                                            |
| AC-C4  | The manager's membership row cannot be added, demoted, or removed: each member mutation returns `"Bad request"` when target == `managerId`. (`project_service.py`)      |
| AC-C5  | `POST /projects` derives `managerId` from the JWT `sub`, ignores any body `managerId`, and seeds `memberIds=[{manager,"owner"}]` + default columns. (`project_service.py`) |
| AC-C6  | `PUT /projects` and `DELETE /projects` require **strict** `managerId == caller` (not merely owner-level), so even another `owner` is `"Forbidden"`. (`project_service.py`) |
| AC-C7  | `PUT /projects` writes only `{projectName, organization, managerId}`; `memberIds` is never writable via the project body. A `managerId` change validates against `users`. |
| AC-C8  | `DELETE /projects` cascades tasks → columns → project (leaves-first). (`project_service.py`)                                                                            |
| AC-C9  | Member add/change-role/remove are `owner`-gated; the roster read is `viewer`-gated and skips dangling user refs. (`project_service.py`)                                 |
| AC-C10 | `GET /projects` (list) returns only projects passing `can_access(viewer)`, applied in Python; a cross-tenant `managerId` probe → `"Forbidden"`. (`project_service.py`) |
| AC-C11 | `wipLimit` is a non-negative `int` (rejects `bool`/float/string); `0` means "no limit". (`board_service.py`)                                                            |
| AC-C12 | `ensure_default_columns` seeds `("To Do","In Progress","Done")` on create AND lazily on board read/create when a project has none. (`column_seed.py`)                   |
| AC-C13 | Column delete removes the column and its tasks, then re-packs sibling `index` values contiguously. (`board_service.py`)                                                 |
| AC-C14 | Task `storyPoints` must be a positive **finite** number (rejects `bool`, `NaN`/`Infinity`, `<=0`). (`task_service.py`)                                                  |
| AC-C15 | `labelIds`/`assigneeIds` must be lists of strings; `startDate`/`dueDate` must be strings when non-empty (no calendar parse). (`task_service.py`)                        |
| AC-C16 | `parentTaskId` must exist, be same-project, and not be self — one level of nesting only. (`task_service.py`)                                                            |
| AC-C17 | Deleting a task **orphans** its sub-tasks to top-level (no cascade-delete) and re-packs indices. (`task_service.py`)                                                    |
| AC-C18 | `PUT /tasks/bulk` excludes `columnId`/`projectId` from the editable set, drops unknown keys, is `editor`-gated on every task's project before any write, and is all-or-nothing on validation (one bad id → `404`). (`task_service.py`) |
| AC-C19 | `PUT /tasks` is `editor`-gated on **both** the current and the (possibly reassigned) target project, and re-validates column↔project + coordinator. (`task_service.py`) |
| AC-C20 | Deleting a label cascade-strips its id from every same-project task's `labelIds`. (`label_service.py`)                                                                  |
| AC-C21 | Comment create derives `projectId` from the **task** (not the body) and requires only `viewer` on that project. (`comment_service.py`)                                  |
| AC-C22 | Comment edit is **author-only** and does not re-process mentions; comment delete is **author OR project manager**. (`comment_service.py`)                               |
| AC-C23 | A mention produces a `"mention"` notification only if the target exists, is a project member (`can_access viewer`), and is not the author; bad mentions are skipped silently. (`comment_service.py`) |
| AC-C24 | `GET /notifications` takes no query params and returns only the caller's own rows; a foreign single mark-read → `"Forbidden"`. There is no producer endpoint. (`notification_service.py`) |
| AC-C25 | Writes pass the `TABLE_FIELDS` allowlist; `password` is stripped from every serialized document. (`repositories.py`, `database.py`)                                     |
| AC-C26 | `TaskDetailPanel` (routed surface) renders only `taskName/coordinator/type/epic/storyPoints/note` — none of the five richness fields, unlike `TaskModal`. (`src/components/taskDetailPanel/index.tsx`) |

---

## 12. Gaps & Next Steps

Unbuilt FE work and natural extension points. None of these are server-side gaps — the backend is complete.

| Gap                                            | What's missing (FE)                                                                              | Extension point                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ✅ Member management                            | Shipped (M4): `ProjectMembersManager` at `/projects/:projectId/members` — owner-gated add / change-role / remove; manager row immutable; read-only for non-owners. | `useProjectMemberMutations` over `projects/members`. |
| ⬜ WIP-limit control                            | A WIP input on column create/edit; an overflow indicator on the column header.                   | `wipLimit` is modeled and validated; wire `board` PUT + a header badge. |
| ⬜ Task richness on the routed panel            | Port the five richness fields from `TaskModal` into `TaskDetailPanel` before flipping `taskPanelRouted`. | Field set already exists in `TaskModal`; copy into the panel body. |
| ⬜ Bulk edit UI                                 | Board multi-select + a fan-out edit affordance calling `PUT /tasks/bulk`.                         | Endpoint is complete (§6.2.1) with no caller.                   |
| ⬜ Label management UI                          | A labels page/modal with create/edit/delete; wire the existing `createLabel`.                    | `useLabels.createLabel` exists with zero callers.               |
| ✅ Comments + @mentions UI                      | Shipped (M4) on `TaskModal`: `useComments` + `CommentsThread` (list/create/edit/delete) with a mention multi-select. Remaining: port to the routed `TaskDetailPanel`. | `useComments`; mention-bearing create invalidates the notifications query. |
| ⬜ Assignees / sub-tasks on cards               | Render `assigneeIds` (avatar stack) and a sub-task hierarchy/tree view.                           | Cards already resolve `labelIds`; same threading applies.       |
| ⬜ Notification kinds beyond `mention`          | `kind` is free-form; new kinds (assignment, due-soon, mention-on-edit) need producers + FE rows.  | `notification_service.create` is generic and extensible.        |

A perf extension point (not a gap): the membership and label/comment cascades scan a project's docs in Python because the query contract is operator-free; an indexed `memberIds.userId` lookup would replace the listing scan at scale (§4.3).

---

## 13. Documentation Debt

**Status: reconciled.** The earlier contradictions between this PRD and the API docs have been closed — [`../api/backend.md`](../api/backend.md) and [`../api/frontend.md`](../api/frontend.md) now describe the shipped collaboration layer (RBAC membership, richness fields, `wipLimit`, and the member / label / comment / notification / bulk surfaces) and may be treated as authoritative. The table below records what was reconciled and where to read it.

| Doc                                          | Previously stale claim / omission                                                                                                                  | Reconciled location                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`../api/backend.md`](../api/backend.md) §10 | "Project access is restricted to the project manager."                                                                                  | Documents the `owner > editor > viewer` RBAC model with the manager as the immutable root of trust ([backend.md](../api/backend.md) "Access Model (RBAC)" + Project Members). |
| [`../api/backend.md`](../api/backend.md) §10–§12 | Documented a **flat** task, columns without `wipLimit`, and no member / label / comment / notification / bulk endpoints. | Full richness model, `wipLimit` semantics, and the member/label/comment/notification/bulk surfaces are all documented in their respective sections. |
| [`../api/frontend.md`](../api/frontend.md)   | The domain-interface table was pre-richness and omitted `IProjectMember`.                                                               | `ITask`/`IColumn` carry the richness fields and the roster is modeled by a separate `IProjectMember` (with rendered `role`) — see the Domain interfaces table. |

**Beyond this PRD's scope (also now documented).** Two feature layers that post-date core-collaboration ship today and are documented in the reconciled API docs, not here:

- **Work-management depth (WMD)** — task `priority`, `dependsOn` / derived `blockedBy`, `milestoneId`, the `milestones` collection + `/api/v1/milestones` CRUD, column `category` (`todo`/`in_progress`/`done`) with derived `isDone`, and the completion / archive / trash lifecycle (`completedAt`/`archivedAt`/`deletedAt`, plus `restore` / `archive` / `?purge`). See [backend.md](../api/backend.md) Tasks / Boards / Milestones sections and the WMD depth fields in [frontend.md](../api/frontend.md). The milestone *shape* as-built (`{name, description, startDate, dueDate, state}`) differs from the work-management-depth PRD's target shape — that model-alignment gap is tracked in [`work-management-depth.md`](work-management-depth.md), not here.
- **Organization tenancy** — `organizationId` on projects, the organizations router, `can_access_org`, and org-gated project creation. See [backend.md](../api/backend.md) Organizations (Tenancy) section.

---

## Appendix A — Endpoint reference

Every non-AI collaboration endpoint. All require a valid REST JWT (§3.1); the **Required role** column is the *additional* per-resource altitude. Auth/users routes are listed at the end as substrate only.

| Method  | Path                          | Required role               | Purpose                                                            |
| ------- | ----------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `POST`  | `/api/v1/projects/`           | authenticated               | Create project (manager from JWT; seeds owner membership + columns)|
| `GET`   | `/api/v1/projects/`           | `viewer`                    | List visible projects, or single by `?projectId`                  |
| `PUT`   | `/api/v1/projects/`           | manager-only                | Update name/org/manager (ownership transfer)                      |
| `DELETE`| `/api/v1/projects/`           | manager-only                | Delete project (cascade tasks → columns → project)                |
| `GET`   | `/api/v1/projects/members`    | `viewer`                    | Member roster `[{_id, username, email, role}]`                    |
| `POST`  | `/api/v1/projects/members`    | `owner`                     | Add / upsert member (idempotent)                                  |
| `PUT`   | `/api/v1/projects/members`    | `owner`                     | Change member role                                                |
| `DELETE`| `/api/v1/projects/members`    | `owner`                     | Remove member                                                     |
| `GET`   | `/api/v1/boards/`             | `viewer`                    | List columns (sorted by index; lazy-seeds defaults)               |
| `POST`  | `/api/v1/boards/`             | `editor`                    | Create column (`wipLimit` default 0)                              |
| `PUT`   | `/api/v1/boards/`             | `editor`                    | Rename / set `wipLimit`                                           |
| `PUT`   | `/api/v1/boards/orders`       | `editor`                    | Reorder columns (same-project)                                    |
| `DELETE`| `/api/v1/boards/`             | `editor`                    | Delete column + its tasks; re-pack indices                        |
| `GET`   | `/api/v1/tasks/`             | `viewer`                    | List tasks (sorted by index; seeds a Default Task)                |
| `POST`  | `/api/v1/tasks/`             | `editor`                    | Create task                                                       |
| `PUT`   | `/api/v1/tasks/`             | `editor` (both projects)    | Update task (all fields except index/_id)                         |
| `DELETE`| `/api/v1/tasks/`             | `editor`                    | Delete task; orphan sub-tasks; re-pack indices                    |
| `PUT`   | `/api/v1/tasks/bulk`          | `editor` (every task)       | Fan-out metadata edit (no columnId/projectId)                     |
| `PUT`   | `/api/v1/tasks/orders`        | `editor`                    | Reorder tasks within / across columns                             |
| `GET`   | `/api/v1/labels/`            | `viewer`                    | List project labels                                               |
| `POST`  | `/api/v1/labels/`            | `editor`                    | Create label (`color` default `#888888`)                          |
| `PUT`   | `/api/v1/labels/`            | `editor`                    | Update name / color                                               |
| `DELETE`| `/api/v1/labels/`            | `editor`                    | Delete label; cascade-strip from tasks                            |
| `GET`   | `/api/v1/comments/`          | `viewer` (task's project)   | List a task's comments (oldest-first)                             |
| `POST`  | `/api/v1/comments/`          | `viewer` (task's project)   | Create comment + fan-out mention notifications                    |
| `PUT`   | `/api/v1/comments/`          | author-only                 | Edit comment body                                                 |
| `DELETE`| `/api/v1/comments/`          | author OR project manager   | Delete comment                                                    |
| `GET`   | `/api/v1/notifications/`     | self only                   | Caller's own notifications (newest-first; no params)              |
| `PUT`   | `/api/v1/notifications/`     | self only                   | Mark one (`{_id}`) or all (`{markAll:true}`) read                 |
| `*`     | `/api/v1/auth/*`             | — (substrate)               | register / login / ai-token / logout (see backend.md)             |
| `*`     | `/api/v1/users/*`            | self / directory (substrate)| own profile, `/users/members` directory, `/users/likes`           |

---

## Appendix B — Data model

Collections written by this layer (per `repositories.py` `TABLE_FIELDS` and `database.py`). `password` is stripped on serialize; `createdAt`/`updatedAt` are repository-managed on every row.

| Collection      | Fields                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `users`         | `_id`, `username`, `email`, `password` (never serialized), `likedProjects`, `createdAt`, `updatedAt` *(substrate — see backend.md)*     |
| `projects`      | `_id`, `projectName`, `organization`, `managerId`, `memberIds` (`[{userId, role}]`), `createdAt`, `updatedAt`                            |
| `columns`       | `_id`, `columnName`, `projectId`, `index`, `wipLimit`, `createdAt`, `updatedAt`                                                          |
| `tasks`         | `_id`, `taskName`, `coordinatorId`, `epic`, `columnId`, `note`, `type`, `projectId`, `storyPoints`, `index`, `startDate`, `dueDate`, `labelIds`, `assigneeIds`, `parentTaskId`, `createdAt`, `updatedAt` |
| `labels`        | `_id`, `projectId`, `name`, `color`, `createdAt`, `updatedAt`                                                                            |
| `comments`      | `_id`, `taskId`, `projectId`, `authorId`, `body`, `mentions`, `createdAt`, `updatedAt`                                                   |
| `notifications` | `_id`, `userId`, `kind`, `refId`, `projectId`, `summary`, `isRead`, `createdAt`, `updatedAt`                                             |

Internal collections (not part of this layer's API): `agent_mutation_journal` (AI undo ledger; see [`v2.1-agent.md`](v2.1-agent.md)) and `system_config` (schema-less; canonical row is the persisted JWT secret).
