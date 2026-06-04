# PRD: Pulse — Accounts, Organizations & Access

| Field | Value |
| --- | --- |
| Status | Draft v1 — proposed. Net-new completeness features for multi-tenant accounts, organizations, invitations, and external access on top of the as-built core; backend + frontend are both unbuilt unless a partial substrate is noted (see the status legend). |
| Author | Product / Engineering — completeness proposal |
| Last updated | 2026-06-04 |
| Target repository | `pulse` (frontend `src/`; backend `backend/`, FastAPI + MongoDB) |
| Document scope | The identity, tenancy, and access layer — first-class organizations and teams, invite-by-email onboarding, email verification + password reset, guest/public read-only access, and self-service account/profile management — proposed on top of the as-built single-tenant core, with the exact data-model, endpoint, and RBAC deltas each feature requires. |
| Companion docs | [`work-management-depth.md`](work-management-depth.md), [`collaboration-notifications.md`](collaboration-notifications.md), [`core-collaboration.md`](core-collaboration.md) (the as-built substrate), [`v2.1-agent.md`](v2.1-agent.md), [`../api/backend.md`](../api/backend.md), [`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) |

---

## 1. TL;DR / Overview

Pulse today is a single-tenant collaboration tool wearing the *vocabulary* of multi-tenancy without any of the machinery. A "project" carries an `organization` field — but it is a **bare free string** (`repositories.py:23`), not a reference to anything; two projects that type `"Acme"` identically are not related, share no roster, and cannot be administered together. There is no organization entity, no team entity, no invitation entity, and no way to bring a person who is not already a registered user onto a project (member-add **requires the target user to already exist** — `project_service.py:236`). Identity itself is similarly thin: a `User` is `username` + `email` + `password` and nothing else (`repositories.py:11-19`), the one self-service mutation (`PUT /users`) has **no frontend caller at all**, and the auth surface has register/login/logout but **no email verification, no password reset, and no account deletion** (`auth.py`).

This PRD specifies the identity-and-tenancy completeness layer that turns Pulse from "a board many people happen to log into" into "an organization with teams, invitations, guests, and managed accounts." It is a **proposal**, not an as-built record: every section marks its current substrate honestly with the status legend (§2.6), and most start from ⬜ (nothing built). The five load-bearing moves are:

- **§3 Organizations** — promote the `organization` string to a first-class `organizations` collection (`name`, `slug`, `members[]` with org roles, `settings`) and give `projects` an `organizationId` foreign key, with a documented migration from the string and the index needed to stop the full-scan project listing (`project_service.py:140-150`) from becoming a cross-tenant liability.
- **§4 Teams** — a per-org `teams` collection so a named group can be assigned to a project, @mentioned, and used as a task assignee, without re-listing every member by hand.
- **§5 Invitations & onboarding** — an invite-by-email flow (a pending `invitations` collection) that finally lets you add someone who has *not yet signed up*, plus the two missing account-lifecycle flows it depends on: **email verification** and **password reset** (the FE `forgotPassword` page exists with no backend behind it).
- **§6 Guest / external access** — a `guest` role below `viewer` and a public, token-gated, **read-only** share path for boards/tasks. Explicitly **not** real-time and **not** CRDT (cross-ref the platform exclusions).
- **§7 Account & profile management** — surface the orphaned `PUT /users`, extend `User` with `displayName` / `avatar` / `timezone` / `locale`, and add account deletion + session/security basics.

§8 acknowledges the enterprise horizon (SSO/OIDC, SCIM, personal access tokens / public API, billing/seats) at a deliberately high level — attach points, not specs — and restates that multi-tenant model-key management stays **excluded** (cross-ref [`v2.1-agent.md`](v2.1-agent.md) N1). This document does **not** re-specify the as-built collaboration core; that is owned by [`core-collaboration.md`](core-collaboration.md), and this layer sits strictly *beneath* it (identity/tenancy → collaboration).

---

## 2. Context & Scope

### 2.1 Where this sits relative to the as-built core

[`core-collaboration.md`](core-collaboration.md) documents the shipped substrate this layer extends: projects with `managerId` + inline `memberIds:[{userId, role}]` (`owner > editor > viewer`), the `can_access(project, user, min_role)` gate, boards/tasks/labels/comments/notifications, and the uniform `MongoRepository` + `TABLE_FIELDS` allowlist contract. **Nothing in that document is re-specified here.** This PRD only adds the layer *above* membership (who the tenant is, how teams group people, how outsiders get in) and *beside* identity (what an account is and how it is managed). The relationship is strictly **identity / tenancy → collaboration**: organizations own projects; teams group org members; invitations mint memberships; the as-built RBAC then governs everything inside a project exactly as it does today.

Three deliberate touch-points with the as-built core are called out where they bite:

- The project **roster + RBAC** (`memberIds`, `can_access`) is reused verbatim; org roles (§3) and the `guest` role (§6) **extend** the role model rather than replacing it.
- The **@mention fan-out** and **notifications inbox** ([`collaboration-notifications.md`](collaboration-notifications.md)) gain team-mention expansion (§4) and new invitation/verification notification kinds (§5) — but the producer/consumer machinery is owned there, referenced here.
- The **single-tenant full-scan project listing** (`project_service.py:140-150`) is the one as-built shortcut this layer is obligated to revisit: once an `organizationId` exists, the scan must be scoped + indexed (§3.5, §10.2).

### 2.2 Goals

- **G1 — Make tenancy real.** Replace the `organization` free string with a first-class `organizations` entity + an `organizationId` foreign key on `projects`, with a non-destructive migration (§3).
- **G2 — Group people.** A per-org `teams` collection that is assignable to projects, @mention-able, and usable as a task assignee (§4).
- **G3 — Onboard outsiders.** An invite-by-email flow that works for people who have **not** registered yet, closing the `project_service.py:236` "target must already exist" gap (§5).
- **G4 — Complete the account lifecycle.** Email verification, password reset (the FE `forgotPassword` page has no backend), and account deletion (§5, §7).
- **G5 — Allow external read access safely.** A `guest` role and a public, token-gated, **read-only** share path that is explicitly not real-time (§6).
- **G6 — Surface self-service identity.** Wire the orphaned `PUT /users` and extend `User` with profile fields (`displayName`, `avatar`, `timezone`, `locale`) (§7).
- **G7 — Keep the wire contract uniform.** Every new endpoint follows the as-built collection-root + id-in-body/query convention with string-sentinel → HTTP mapping and an explicit required RBAC altitude (Appendix A).

### 2.3 Non-goals

- **N1 — Re-specifying the collaboration core.** Projects/boards/tasks/labels/comments/notifications internals are owned by [`core-collaboration.md`](core-collaboration.md).
- **N2 — Built specs for the enterprise horizon.** SSO/OIDC, SCIM, personal access tokens / public API, and billing/seats are acknowledged at attach-point granularity only (§8) — none are specified here.
- **N3 — Multi-tenant model-key management.** Each deployment holds **one** provider key server-side; per-org/per-tenant keys stay **excluded** (cross-ref [`v2.1-agent.md`](v2.1-agent.md) N1). Organizations introduced here are an *identity/tenancy* boundary, not a billing or key-isolation boundary.
- **N4 — Real-time / CRDT anything.** Public share links (§6) are **read-only snapshots over polling**, explicitly **not** live co-editing; CRDT/Yjs co-editing stays excluded.
- **N5 — Replacing JWT auth.** Login-issued JWT remains the only first-party auth (`security.py`); this PRD adds account *lifecycle* flows (verify/reset/delete) and invitation tokens, not a new session mechanism.
- **N6 — Building the AI/admin/audit/export surfaces.** The admin AI-gating dashboard (M6), org-wide audit history (M8), and export/webhooks (M7) are already planned elsewhere and are cross-referenced as deferred, not specified here (§10.3).

### 2.4 Goals/Non-goals — quick reference

- **G1 — Real tenancy.** `organizations` entity + `projects.organizationId`, migrated from the string.
- **G2 — Teams.** Per-org `teams`, assignable / mentionable / assignee-capable.
- **G3 — Invite outsiders.** Invite-by-email for not-yet-registered people.
- **G4 — Account lifecycle.** Verification, reset, deletion.
- **G5 — Safe external read.** `guest` role + public read-only share tokens (not real-time).
- **G6 — Self-service identity.** Wire `PUT /users`; add profile fields.
- **G7 — Uniform wire contract.** Collection-root + sentinel→HTTP everywhere.
- **N1 — Not** re-spec of the core. **N2 — Not** enterprise-horizon specs. **N3 — Not** multi-tenant model keys (excluded). **N4 — Not** real-time/CRDT. **N5 — Not** a new auth mechanism. **N6 — Not** admin/audit/export (planned elsewhere).

### 2.5 Out of scope / explicitly excluded (platform horizon only)

These are acknowledged at the horizon level in §8 and must **not** be read as built specifications in this document: SSO/OIDC login, SCIM provisioning, personal access tokens / a public API, and billing/seats. Separately and permanently excluded from this product line: **multi-tenant model-key management** (one key per deployment — [`v2.1-agent.md`](v2.1-agent.md) N1), **MCP**, **voice**, **CRDT/Yjs co-editing**, **cross-project planning**, and **configurable end-user prompts**. Public read-only share links (§6) are in scope but are constrained to **read-only, non-real-time** by design.

### 2.6 Status legend

Every feature's **Current state** callout uses this legend. It mirrors [`core-collaboration.md`](core-collaboration.md) §2.3 so the two documents read consistently. Because this PRD is a *proposal*, the honest answer for most rows is ⬜.

| Symbol | Meaning |
| --- | --- |
| ✅ | **Shipped** — backend complete AND a working, user-reachable FE surface exists. |
| 🟡 | **Partial** — backend complete; FE exists but is incomplete (read-only / chip-only / one of two surfaces). |
| 🔧 | **Backend-only** — backend complete; NO FE surface (no hook, no component) consumes it. |
| ⬜ | **Planned** — not built (proposed in this document). |

---

## 3. Organizations / workspaces

The headline change: make the tenant a real thing. Everything else in this document hangs off it.

### 3.1 Current state

There is **no organization entity**. `projects` carries a single free-text field `organization` (`repositories.py:23`), validated only as "non-empty string" on create (`projects.py:21-24`) and writable as a plain string via `PUT /projects` (`_PROJECT_UPDATE_FIELDS` in `project_service.py:13`). Two projects with `organization == "Acme"` share **nothing** — no roster, no settings, no administrative grouping; the string is a label, not a key. The project listing scans **all** projects and filters by `can_access` in Python (`project_service.py:140-150`), with **no tenant boundary** — the only thing keeping one customer's projects out of another's list is per-project membership, not tenancy.

### 3.2 Proposed model — `organizations`

Introduce a first-class collection `organizations` (new `database.ORGANIZATIONS = "organizations"`; new `TABLE_FIELDS[organizations]` allowlist entry):

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | `str` | Repository-managed. |
| `name` | `str` | Display name. Required, non-empty. |
| `slug` | `str` | URL-safe unique handle (lowercased, `[a-z0-9-]`). Uniqueness enforced in-service (read-before-write, mirroring the username/email checks in `auth_service.py:41`); a unique index backs it (§10.4). |
| `members` | `[{userId: str, role: str}]` | Org roster, **inline** exactly like `projects.memberIds` so the as-built read/normalize pattern (`_normalized_members`, `project_service.py:204-216`) is reused. Org roles: `org_owner > org_admin > member`. |
| `settings` | `dict` | Schemaless org-level preferences (e.g. default project visibility, default new-member project role, allowed invite domains). Free-form by design, consistent with the schemaless-dict house style. |
| `createdAt` / `updatedAt` | `datetime` | Repository-managed. |

**Org role model** — a new, parallel ordered hierarchy (it does **not** replace the project `owner/editor/viewer` ranks; the two compose):

- `org_owner` (rank 3) — full control incl. deleting the org, transferring org ownership, managing billing/seats *when that horizon lands* (§8).
- `org_admin` (rank 2) — manage org members, teams, invitations, and create projects; cannot delete the org.
- `member` (rank 1) — belongs to the org; can be added to projects and teams; default for invitees.

A helper `can_access_org(org_or_doc, user_id, min_org_role)` mirrors `can_access` (`project_service.py:56-81`) exactly: ordered ranks, membership in `members`, returns the boolean gate. There is **no** org-level "manager root of trust" shim — the `managerId` concept is project-scoped and stays project-scoped; org ownership is an ordinary `org_owner` membership that the create path seeds.

### 3.3 `projects` changes — `organizationId` replaces the string

`projects` gains `organizationId: str` (a reference to `organizations._id`) and **deprecates** the free `organization` string (`repositories.py:23`). During migration both fields coexist in the allowlist (§3.4); post-migration, `organization` is dropped from `TABLE_FIELDS[projects]` and `_PROJECT_UPDATE_FIELDS` so it can no longer be written. New invariants:

- `POST /projects` requires `organizationId` (replacing `organization`) and **rejects** it unless the caller is `org_admin`+ on that org (a `member` cannot create projects unless `settings` opts in). The existing anti-confused-deputy rule is preserved: `managerId` is still derived from the JWT `sub`, never the body (`project_service.py:91-108`).
- `PUT /projects` may change `projectName` (and `managerId`, the existing project-ownership transfer) but **not** `organizationId` — moving a project between orgs is a distinct, `org_admin`-gated operation (§3.6, `POST /organizations/projects`), because it changes the tenancy boundary and must re-scope membership.

### 3.4 Migration — string → entity

A one-shot, idempotent, **non-destructive** backfill (a `backend/app/` script invoked once, in the spirit of `agents/task_vector_backfill.py`):

1. **Distinct-scan** existing `projects` for unique `organization` strings (case-insensitive, trimmed).
2. For each distinct value, **upsert** an `organizations` row: `name` = the original string, `slug` = a slugified+de-duplicated handle, `members` = the union of every owning `managerId` and `memberIds.userId` across projects that carried that string — each seeded as `member`, **except** the most-senior owner of the first project (a deterministic pick) seeded `org_owner` so the org is never owner-less.
3. **Stamp** each project with the resulting `organizationId`, leaving the legacy `organization` string in place for one release (dual-write window) so a rollback is a no-op.
4. After verification, a follow-up release drops the `organization` field from the allowlist + `_PROJECT_UPDATE_FIELDS`. Until then, writes that set `organization` are still accepted but ignored by the listing scope.

Because `validate_fields` (`repositories.py:143-147`) rejects unknown keys, **the allowlist must be widened before the backfill writes `organizationId`** — `organizationId` is added to `TABLE_FIELDS[projects]` in the same change that ships the migration.

### 3.5 Tenancy & the full-scan listing

`GET /projects` (no `projectId`) today fetches the candidate set with a flat filter and applies `can_access(viewer)` in Python over **every** project (`project_service.py:140-150`). With orgs, the listing **must** scope by tenant first: the query becomes `find_many(PROJECTS, {"organizationId": <org>})` for the caller's current org (or the union of the caller's org memberships), then the existing Python `can_access` filter runs over that already-narrowed set. This (a) makes the scan **O(projects-in-org)** instead of **O(all-projects)** and (b) closes the latent cross-tenant exposure where a future bug in `can_access` would leak across customers. An index on `projects.organizationId` (and on `organizations.members.userId`) backs it (§10.4). This is the single most important interaction this PRD has with the as-built core, and it is mandatory, not optional.

### 3.6 Endpoints — `organizations`

Collection-root, id-in-body for `PUT`, id-in-query for `DELETE`/`GET`; sentinels map via `validation.py` exactly as the as-built routers do (Bad request→400, Forbidden→403, not found→404).

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/api/v1/organizations/` | authenticated | Create org; creator seeded `members=[{caller, "org_owner"}]`. `name` required; `slug` derived/validated-unique (→ `"Bad request"` on collision). |
| `GET` | `/api/v1/organizations/` | `member` (per org) | List the caller's orgs, or one by `?organizationId`. Single → `"Forbidden"` if caller is not a member. |
| `PUT` | `/api/v1/organizations/` | `org_admin` | Update `{name, slug, settings}`; `members` is **not** writable here (use the member sub-resource). |
| `DELETE` | `/api/v1/organizations/` | `org_owner` | Delete (`?organizationId=`). Refused (`"Bad request"`) while the org still owns projects — projects must be moved or deleted first (no silent cascade across the tenancy boundary). |
| `GET` | `/api/v1/organizations/members` | `member` | Org roster `[{_id, username, email, role}]`, skipping dangling user refs (reusing the `list_members` shape, `project_service.py:319-334`). |
| `POST` | `/api/v1/organizations/members` | `org_admin` | Add/upsert an **existing** user to the org (idempotent role update). For not-yet-registered people, use invitations (§5). Refuses to demote/remove the last `org_owner` (→ `"Bad request"`). |
| `PUT` | `/api/v1/organizations/members` | `org_admin` | Change an org member's role; last-`org_owner` guard applies. |
| `DELETE` | `/api/v1/organizations/members` | `org_admin` | Remove (`?organizationId=&userId=`); last-`org_owner` guard applies. Removing an org member does **not** auto-strip their per-project memberships in v1 (called out as Open Question §10.1 OQ-2). |
| `POST` | `/api/v1/organizations/projects` | `org_admin` (both orgs) | Move a project between orgs (`{projectId, organizationId}`); re-scopes the listing and is the only path that rewrites `projects.organizationId`. |

### 3.7 UX / surfaces

- An **org switcher** in the header (sibling to the existing global member popover, `src/components/memberPopover/index.tsx`) selecting the active org; the project list and create flow scope to it.
- An **Organization settings** page (new) with a **Members** tab (add/change-role/remove, rendering org roles — note the as-built `IProjectMember.role` is *modeled but never rendered*, `src/interfaces/projectMember.d.ts:13`; this is the first surface to render any role), a **Teams** tab (§4), and an **Invitations** tab (§5).
- `ProjectModal` (`src/components/projectModal/index.tsx`) replaces its free-text **organization** input with an **org picker** sourced from the caller's `organizations` memberships.

### 3.8 Current state — ⬜ Planned

Org is a **bare string** today (`repositories.py:23`); no entity, no roster, no settings, no tenant scoping. Entire section is net-new (backend + frontend).

---

## 4. Teams / groups

### 4.1 Current state

There is **no team/group entity** anywhere in the tree (no `teams` collection, no `database.TEAMS`, no service). The only collective construct is a project's inline `memberIds` (`project_service.py`), which is a flat per-project list with no reusable, named subset. Assigning "the design team" to three projects, or @mentioning them, means enumerating every person by hand each time.

### 4.2 Proposed model — `teams`

A per-org collection `teams` (new `database.TEAMS = "teams"`; new `TABLE_FIELDS[teams]`):

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | `str` | Repository-managed. |
| `organizationId` | `str` | Owning org (reference to `organizations._id`). Required. A team never spans orgs. |
| `name` | `str` | Required, unique within the org (read-before-write check). |
| `memberIds` | `[str]` | Flat list of `users._id`. Every member **must** also be an org `member` (validated on add; an org-removal is an Open Question for cascade, §10.1 OQ-2). |
| `createdAt` / `updatedAt` | `datetime` | Repository-managed. |

**Team membership** is a flat id list (`[str]`), deliberately simpler than project `memberIds` (no per-team role) — a team is a *grouping*, not an authorization scope. Authorization always resolves through the project/org role of the individual; a team grants no permissions by itself.

### 4.3 Where teams are usable

- **Assignable to projects** — adding a team to a project expands to per-user project memberships (each team member gets the chosen project role via the existing `add_member` path, `project_service.py:219-249`), so the as-built `can_access` model is untouched. The team→project link is recorded so later membership changes can re-sync (re-sync policy is OQ-3, §10.1).
- **@mention-able** — a `@team` mention expands, at fan-out time, to its current `memberIds`, then each resolved user goes through the *existing* per-recipient mention guard (must exist, be a project member via `can_access(viewer)`, not be the author) owned by [`collaboration-notifications.md`](collaboration-notifications.md). Expansion happens in the producer; the notification machinery is unchanged. Non-member team members are skipped silently, exactly as bad individual mentions are today.
- **Usable as a task assignee** — a task may carry a team reference alongside the existing `coordinatorId` / `assigneeIds`. To keep the as-built tasks contract intact (and the `TABLE_FIELDS[tasks]` allowlist honest), this is modeled as a new `assigneeTeamIds: [str]` field on `tasks` (added to the allowlist), expanded to individuals for notification/standup purposes by the consumer; `coordinatorId` (the single primary assignee) is unchanged. Task-field depth is otherwise owned by [`work-management-depth.md`](work-management-depth.md); this PRD only contributes the team-assignee linkage.

### 4.4 Endpoints — `teams`

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `GET` | `/api/v1/teams/` | `member` (org) | List the org's teams (`?organizationId=`), or one by `?teamId=`. |
| `POST` | `/api/v1/teams/` | `org_admin` | Create (`{organizationId, name}`). Name unique-in-org (→ `"Bad request"` on collision). |
| `PUT` | `/api/v1/teams/` | `org_admin` | Rename / set `memberIds` (`{_id, name?, memberIds?}`); `organizationId` immutable. Members validated as org members. |
| `DELETE` | `/api/v1/teams/` | `org_admin` | Delete (`?teamId=`). Cascade-strips the team from any project-team links and from task `assigneeTeamIds` (mirroring the as-built label cascade, `label_service.py`). |
| `POST` | `/api/v1/teams/assign` | `editor` (project) + `member` (org) | Assign a team to a project at a given project role; fans out to per-user `memberIds` (`{teamId, projectId, role}`). |

### 4.5 UX / surfaces

- A **Teams** tab in Organization settings (§3.7): create team, manage members (org-member picker), delete.
- Team chips appear anywhere a member set is shown; the **assignee select** in the task surface(s) (today only the legacy `taskModal`, per [`core-collaboration.md`](core-collaboration.md) §6.5) gains a team option group.
- The @mention composer (once it exists — the mention *producer* has no UI today, [`collaboration-notifications.md`](collaboration-notifications.md)) offers `@team` suggestions.

### 4.6 Current state — ⬜ Planned

No team entity exists; net-new backend + frontend. Depends on §3 (teams are org-scoped).

---

## 5. Invitations & onboarding

### 5.1 Current state

Two concrete gaps:

- **Member-add requires an existing user.** `POST /projects/members` (and the proposed `POST /organizations/members`) calls `repository.find_by_id(USERS, target)` and returns `"Member not found"` if the user does not exist (`project_service.py:236`). There is **no invite-by-email**, **no pending-invitation** record, and therefore no way to bring a brand-new person onto a project/org before they have an account.
- **The account lifecycle is half-built.** The only auth flows that exist are `POST /auth/register`, `POST /auth/login`, `POST /auth/ai-token`, `POST /auth/logout` (`auth.py`). There is **no email verification** (a registered email is trusted as-is, `auth_service.py:27-88`) and **no password reset** — the self-service `PUT /users` is the *only* way to change a password (`user_service.py:80-93`), it has **no FE caller**, and the `forgotPassword` page (`src/pages/forgotPassword/`) is **UI-only with no backend behind it**.

### 5.2 Proposed model — `invitations`

A pending-invitation collection `invitations` (new `database.INVITATIONS = "invitations"`; new `TABLE_FIELDS[invitations]`):

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | `str` | Repository-managed. |
| `token` | `str` | High-entropy opaque token (`secrets.token_urlsafe`, same primitive family as `security.py`). The lookup key for accept; **never** the `_id`. Stored hashed at rest (only the hash is persisted; the raw token rides the email link), so a DB read cannot replay an invite. |
| `email` | `str` | Invitee email (normalized lowercase). |
| `role` | `str` | The role to grant on accept — an org role (`org_admin`/`member`) when `scope=="org"`, or a project role (`owner`/`editor`/`viewer`/`guest`) when `scope=="project"`. |
| `scope` | `str` | `"org"` or `"project"`. |
| `targetId` | `str` | The `organizations._id` or `projects._id` the invite grants into. |
| `invitedBy` | `str` | `users._id` of the inviter (must hold the gating role on `targetId` at send time). |
| `expiresAt` | `datetime` | TTL (default 14 days); past-expiry tokens are rejected on accept and swept (§5.5). |
| `status` | `str` | `pending` → `accepted` / `revoked` / `expired`. |
| `createdAt` / `updatedAt` | `datetime` | Repository-managed. |

### 5.3 Invitation flow

- **Send.** `POST /invitations` (`org_admin` for `scope=="org"`; project `owner` for `scope=="project"`, matching the as-built member-mutation altitude, `project_service.py:228`). Mints a `pending` row + token, emails the link. If the email already maps to a registered user, the invite still records intent (accept simply attaches the membership immediately on the next authenticated load) — so the flow is uniform for existing and new users.
- **Accept on signup.** An unauthenticated invitee opens the link, lands on `register` pre-filled with the invited `email`, and on successful `POST /auth/register` the pending invite(s) for that email are **consumed**: the membership is written via the existing `add_member` path (`project_service.py:219-249`) or the org member path (§3.6), and `status` flips to `accepted`. This is the missing bridge — registration now *can* be driven by an invite rather than requiring the inviter to know an existing `userId`.
- **Accept on login.** An already-registered invitee who logs in (or is already authenticated) has any `pending` invites for their verified email auto-attached on next load via `POST /invitations/accept {token}` (idempotent; a second accept is a no-op).
- **Revoke.** `DELETE /invitations` (`?invitationId=`) by an inviter with the gating role flips `status` to `revoked`; the token stops working immediately.

The token is the capability — possession of the link is sufficient to accept **for the named email**; accept binds the membership to the authenticated/just-registered account whose verified email matches, so a forwarded link cannot grant a stranger access to a different email's invite.

### 5.4 Email verification & password reset (folded in)

Both are net-new and both are prerequisites for trustworthy invitations:

- **Email verification.** `User` gains `emailVerified: bool` (default `false`) and verification is a token flow paralleling invitations: `POST /auth/verify-email/request` (authenticated) mints a short-TTL token + emails it; `POST /auth/verify-email/confirm {token}` sets `emailVerified=true`. Invite-accept that *creates* the membership may proceed, but org `settings.requireVerifiedEmail` (when set) can gate sensitive actions on a verified address. Register stays as-is otherwise (`auth_service.py:27-88`).
- **Password reset.** Finally backs the orphaned `forgotPassword` page: `POST /auth/password-reset/request {email}` always returns `200` regardless of whether the email exists (preserving the **anti-enumeration** posture already designed into login, `auth_service.py:118-122`) and, only for a real user, emails a reset token; `POST /auth/password-reset/confirm {token, password}` re-hashes via the existing `encrypt_password` (PBKDF2-SHA256, 600k iters, `security.py:38-46`) and writes the new hash. Password rules reuse `MIN_PASSWORD_LENGTH` (`user_service.py:86`). Reset tokens are single-use and short-TTL, stored hashed like invite tokens.

A small **reset/verification token** collection (or a typed reuse of `invitations` with `scope ∈ {email_verify, password_reset}`) backs these; Appendix B lists it as `auth_tokens` for clarity, with the same hashed-token + `expiresAt` + single-use discipline.

### 5.5 Endpoints — invitations & lifecycle

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/api/v1/invitations/` | `org_admin` (org scope) / project `owner` (project scope) | Create + email invite. → `"Invitation sent"`. Re-inviting a still-`pending` email refreshes the token/TTL (idempotent). |
| `GET` | `/api/v1/invitations/` | `org_admin` / project `owner` | List `pending` invites for `?organizationId=` or `?projectId=`. |
| `POST` | `/api/v1/invitations/accept` | authenticated | Consume `{token}`; attach membership to the caller iff the caller's **verified** email matches; idempotent. → `"Invitation accepted"` / `"Bad request"` (bad/expired/mismatched). |
| `DELETE` | `/api/v1/invitations/` | inviter w/ gating role | Revoke (`?invitationId=`). |
| `POST` | `/api/v1/auth/verify-email/request` | authenticated | Mint + email a verification token. |
| `POST` | `/api/v1/auth/verify-email/confirm` | token-gated | `{token}` → set `emailVerified=true`. |
| `POST` | `/api/v1/auth/password-reset/request` | unauthenticated | `{email}` → always `200`; emails a reset token only for a real user (anti-enumeration). |
| `POST` | `/api/v1/auth/password-reset/confirm` | token-gated | `{token, password}` → re-hash + store; single-use token. |

Expired/consumed tokens are rejected on use and swept by a periodic job (or lazily on next read). New notification kinds (`invitation`, `email_verified`) plug into the existing extensible producer (`kind` is free-form, [`collaboration-notifications.md`](collaboration-notifications.md)).

### 5.6 UX / surfaces

- **Invitations tab** in Organization settings (and a per-project invite affordance for project-scope invites): enter email + role, send; list/revoke pending invites.
- **Register** pre-fills the invited email and shows "You've been invited to *Org / Project*".
- **`forgotPassword`** (`src/pages/forgotPassword/`) is wired to `password-reset/request`; a new **reset** page consumes the token. A **verify-email** banner/CTA appears for `emailVerified == false`.

### 5.7 Current state — ⬜ Planned

No invitation entity; member-add requires an existing user (`project_service.py:236`); email verification absent; password reset is **FE-only** (`forgotPassword` page, no backend). Net-new backend + frontend.

---

## 6. Guest / external access & public share links

### 6.1 Current state

RBAC is `owner > editor > viewer`, and **every** role is an authenticated project member (`project_service.py:18-22`). There is **no role below viewer**, **no guest concept**, and **no unauthenticated read path** of any kind — every collaboration route depends on `current_user_payload` and a valid REST JWT (`security.py:154-176`). A person without an account cannot see a board, even read-only.

### 6.2 Proposed — a `guest` role (scoped, read-mostly)

Extend the ordered project role model with `guest` **below** `viewer`:

```
ROLE_RANK = { "guest": 0, "viewer": 1, "editor": 2, "owner": 3 }   # extended
VALID_ROLES = { "guest", "viewer", "editor", "owner" }              # extended
```

A `guest` is an authenticated user (e.g. an external collaborator, a client) with **read access to the board/tasks and comment-create only if explicitly granted**, but **no** member-management, no project settings, and — by default — a *narrowed* read (e.g. can see tasks but not the full member roster). Because the model is already a clean ordered gate (`can_access`, `project_service.py:56-81`), adding rank `0` is a localized change: every existing `min_role` check (read=viewer, write=editor, admin=owner) **automatically excludes guests from writes** because `guest(0) < viewer(1)`. The only deliberate addition is allowing `guest` where a feature opts into "read for guests" (e.g. board read). Guests are invited via the §5 invitation flow with `role == "guest"`.

### 6.3 Proposed — public read-only share tokens

For truly *unauthenticated* sharing (a public board link), a capability-token entity `share_tokens` (new `database.SHARE_TOKENS = "share_tokens"`; new `TABLE_FIELDS[share_tokens]`):

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | `str` | Repository-managed. |
| `token` | `str` | High-entropy opaque token (`secrets.token_urlsafe`); the only credential the public path accepts. Stored hashed; raw token lives only in the shared URL. |
| `scope` | `str` | `"board"` or `"task"` (extensible). |
| `targetId` | `str` | The `projects._id` (board) or `tasks._id` the token exposes. |
| `projectId` | `str` | Owning project (for revocation/scoping joins). |
| `createdBy` | `str` | `users._id` of the project `owner` who minted it. |
| `expiresAt` | `datetime` | Optional TTL (`null` = no expiry); revocable any time. |
| `revoked` | `bool` | Soft kill-switch (default `false`). |
| `createdAt` / `updatedAt` | `datetime` | Repository-managed. |

A **separate, unauthenticated, token-gated read path** serves these — it does **not** go through `current_user_payload`; it resolves the token, checks `revoked`/`expiresAt`, and returns a **read-only snapshot** of the board/task (tasks, columns, labels — never members, never comments authorship beyond display, never anything mutating). It is **strictly `GET`** — there is no token-authenticated write endpoint, so a share link can never edit. Minting/revoking tokens is project-`owner`-gated through the normal authenticated API.

### 6.4 Explicitly NOT real-time / NOT CRDT

The public share path is a **polling read of a snapshot**, consistent with the as-built no-WebSocket-push model ([`core-collaboration.md`](core-collaboration.md) N3). It is **not** live, **not** collaborative editing, and **not** CRDT/Yjs — those stay excluded (§2.5, cross-ref [`v2.1-agent.md`](v2.1-agent.md)). A viewer of a public link sees data as of their last fetch; there is no push, no presence, and no write. This constraint is a hard design boundary, not a v1 simplification to relax later.

### 6.5 Endpoints — guest & share tokens

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/api/v1/share-tokens/` | project `owner` | Mint a public read token (`{projectId, scope, targetId, expiresAt?}`). → `"Share link created"`. |
| `GET` | `/api/v1/share-tokens/` | project `owner` | List a project's share tokens (`?projectId=`). |
| `DELETE` | `/api/v1/share-tokens/` | project `owner` | Revoke (`?shareTokenId=`) — sets `revoked=true`. |
| `GET` | `/api/v1/public/board` | **none** (token only) | `?token=` → read-only board snapshot (columns + tasks + labels). 404/`"Bad request"` on missing/revoked/expired. |
| `GET` | `/api/v1/public/task` | **none** (token only) | `?token=` → read-only task snapshot. |

`guest` itself adds no endpoints — it is a role value accepted by the existing `add_member` / invitation paths and honored by `can_access`.

### 6.6 UX / surfaces

- A **Share** affordance on the board/task surface (project `owner`): create/copy/revoke a public link, optionally set an expiry.
- A minimal **public viewer** route (unauthenticated) that renders the read-only snapshot with a clear "read-only / shared" chrome and no editing controls.
- Guests appear in the roster with a distinct `guest` badge once roles are rendered (§3.7).

### 6.7 Current state — ⬜ Planned

RBAC is `owner/editor/viewer`, all authenticated members; no role below viewer and **no public/unauthenticated read path** (`security.py:154-176`). Net-new backend + frontend.

---

## 7. Account & profile management

### 7.1 Current state

A `User` is `username`, `email`, `password` (PBKDF2-SHA256, never serialized), `likedProjects[]`, timestamps (`repositories.py:11-19`) — **no `displayName`, no `avatar`, no `timezone`, no `locale`, no roles/isAdmin**. The one self-service mutation, `PUT /users`, exists and works (`users.py:22-43`) but allows **only** `{username, email, password}` (`USER_UPDATE_FIELDS`, `user_service.py:12`) and has **no FE caller at all** — username/email/password **cannot be changed in-app** (`settings.tsx` exposes only theme/language/AI-toggle/logout; there is no profile/account surface). There is **no account deletion** (`auth.py` has register/login/ai-token/logout only) and no session/security management.

### 7.2 Proposed — extend `User`

Add four profile fields to `users` (extend `TABLE_FIELDS[users]` and the `USER_UPDATE_FIELDS` self-service allowlist — **never** add a privilege field there; the existing comment at `user_service.py:9-11` is explicit that any allowlisted key grants self-write):

| Field | Type | Notes |
| --- | --- | --- |
| `displayName` | `str` | Human-friendly name distinct from the unique `username`. Optional; defaults to `username`. |
| `avatar` | `str` | Avatar reference — a URL or stored-object id. The FE already renders deterministic initials via `UserAvatar` (`src/components/userAvatar`), so this is an *override*, not a hard dependency. |
| `timezone` | `str` | IANA tz (e.g. `"Australia/Sydney"`). Drives due-date/overdue display once consumed (overdue logic is owned by [`work-management-depth.md`](work-management-depth.md)). Validated as a known tz string. |
| `locale` | `str` | Maps to the existing FE locale set (`src/i18n`); persisting it server-side lets locale follow the account across devices instead of living only in client state. |

These flow through the existing `PUT /users` shape (which already mirrors `GET /users` so the FE can drop the result straight into the shared `users` React Query cache, `users.py:38-43`). No new write endpoint is required for profile edits — the gap is purely the **missing FE caller** plus the four fields.

### 7.3 Proposed — account deletion

A new self-service deletion flow (absent today):

- `DELETE /api/v1/users/` (self only; the caller id is the JWT `sub`, never a body/query param, matching the anti-spoof posture throughout the as-built core). Soft-delete first (`status: "deleted"` + anonymization of `email`/`username` to free the unique handles) so authored comments/tasks do not dangle; the as-built roster reads already **skip dangling user refs** (`project_service.py:321-324`), so a deleted author degrades gracefully.
- **Guards:** a sole `org_owner` cannot delete their account while they are the last owner of an org that still owns projects (→ `"Bad request"`), mirroring the §3.6 last-owner and §3.6 non-empty-org guards. Project `managerId` reassignment is required before a manager deletes (or the deletion is refused with guidance), since `managerId` is the immutable project root of trust.

### 7.4 Proposed — session / security basics

Minimal, riding the existing JWT/cookie model (`security.py`, `auth.py`) — **not** a new auth mechanism (N5):

- **Change password while logged in** is already possible via `PUT /users` (`password` field, re-hashed in `user_service.py:106-107`) — this proposal simply gives it a UI on the account surface.
- **Logout-everywhere / session invalidation** is acknowledged as desirable but constrained: JWTs are stateless HS256 with a fixed expiry (`security.py:89-97`), so true server-side revocation needs a token-version/`jti` denylist — flagged as an Open Question (§10.1 OQ-5), not specified here.
- **Active-email + verification status** (from §5.4) surface on the account page.

### 7.5 Endpoints — account & profile

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `GET` | `/api/v1/users/` | self | Read own record (as-built). |
| `PUT` | `/api/v1/users/` | self | Update `{username, email, password, displayName, avatar, timezone, locale}` (allowlist extended; privilege fields forbidden by design). |
| `DELETE` | `/api/v1/users/` | self | Soft-delete + anonymize own account; last-owner / project-manager guards apply. |

### 7.6 UX / surfaces

- A new **Account / Profile** section (extending `settings.tsx`, which today has only theme/language/AI-toggle/logout): edit `displayName` / `avatar` / `timezone` / `locale`, change username/email/password (the **first** FE caller of `PUT /users`), and a guarded **Delete account** action.
- `timezone` / `locale` read back into the existing FE locale (`src/i18n`) and date rendering so preferences persist across devices.

### 7.7 Current state — 🔧 Backend-only (partial substrate)

`PUT /users` **exists** but has **no FE caller** (`users.py:22-43`, `user_service.py:12`); there are **no** profile fields and **no** account deletion. Profile-field additions, deletion, and the entire account UI are net-new; the self-update endpoint is the partial substrate.

---

## 8. Platform horizon (deliberately high-level — NOT full specs)

These are the enterprise-completeness frontier. They are sketched at **attach-point** granularity so a reader knows where they would hook, and are **not** specified, designed, or committed here.

**SSO / OIDC login.** Today the login-issued JWT is the only auth, with no SSO/OAuth (`security.py`). An OIDC provider would attach at the auth layer: an `/auth/oidc/*` exchange that, on a verified assertion, mints the same REST cookie + AI-proxy token the password path already issues (`auth_service.py:144-151`), provisioning a `User` on first login (just-in-time) and binding it to the matched org by email domain (`organizations.settings.allowedDomains`). The downstream RBAC and session model are unchanged — only the *credential* differs.

**SCIM provisioning.** With orgs + org roles (§3) and invitations (§5) in place, SCIM is the automated bulk analogue: a `/scim/v2/Users` + `/scim/v2/Groups` surface that creates/deactivates org `members` and syncs `teams` (§4) from an external IdP. It attaches to the org-member and team services as an alternate, machine-driven writer; it presupposes SSO and is strictly post-§3/§4.

**Personal access tokens / public API.** The brief notes there are **no** API tokens / PATs today — login JWT is everything. A PAT model would add a `personal_access_tokens` collection (hashed token, owner, scopes, `expiresAt`) and a bearer path that resolves a PAT to a user with a *narrowed* scope set, reusing the existing scope plumbing (`token_scope`, `JWT_SCOPE_*` in `security.py:122-128`) rather than inventing a parallel one. It attaches at `_extract_bearer` / the auth dependency. This is the gateway to a documented public REST API over the same collection-root endpoints.

**Billing / seats.** Orgs are the natural billing boundary, but **not** in this PRD: a `billing` facet on `organizations.settings` (or a sibling `subscriptions` collection) plus seat-counting against `organizations.members` would attach to org membership writes (enforce seat caps at `POST /organizations/members` and at invite-accept, §3.6/§5.5). No pricing, metering, or payment integration is implied.

**Permanently excluded — multi-tenant model keys.** Even with first-class orgs, the deployment holds **one** provider key server-side; per-org/per-tenant model-key management stays out of scope (cross-ref [`v2.1-agent.md`](v2.1-agent.md) N1). Orgs here are an identity/tenancy boundary, **not** a key-isolation boundary.

### 8.1 Current state — ⬜ Planned

None of SSO/OIDC, SCIM, PATs/public API, or billing/seats exists; all are horizon-level acknowledgements, not specs. Multi-tenant model keys remain excluded.

---

## 9. Acceptance Criteria

Proposed-state invariants. Each cites the source it builds on or the target it must satisfy; a reviewer can ground every row against the cited code or this document.

| ID | Acceptance criterion |
| --- | --- |
| AC-O1 | `organizations` is a first-class collection (`name`, `slug`, `members:[{userId, role}]`, `settings`) with a `TABLE_FIELDS[organizations]` allowlist; unknown fields are rejected by `validate_fields`. (extends `repositories.py:10-97`) |
| AC-O2 | Org roles are totally ordered `org_owner(3) > org_admin(2) > member(1)`; `can_access_org` passes iff the caller's org rank ≥ the gate, mirroring `can_access`. (mirrors `project_service.py:56-81`) |
| AC-O3 | `projects` gains `organizationId` (a reference to `organizations._id`) replacing the free `organization` string; both coexist only during the migration window, after which `organization` is removed from the allowlist and `_PROJECT_UPDATE_FIELDS`. (replaces `repositories.py:23`, `project_service.py:13`) |
| AC-O4 | The string→entity migration is idempotent and non-destructive: it upserts one `organizations` row per distinct `organization` string, seeds at least one `org_owner`, stamps `projects.organizationId`, and leaves the legacy string in place for one release. (§3.4) |
| AC-O5 | `GET /projects` (list) scopes by `organizationId` **before** the Python `can_access` filter, so the scan is O(projects-in-org) and cannot cross a tenant boundary. (replaces the full scan at `project_service.py:140-150`) |
| AC-O6 | `POST /organizations` seeds the creator as `org_owner`; `PUT /organizations` writes only `{name, slug, settings}` (never `members`); `DELETE /organizations` is `org_owner`-gated and refused while the org still owns projects. (§3.6) |
| AC-O7 | Org member add/change-role/remove are `org_admin`-gated and refuse to demote/remove the **last** `org_owner` (→ `"Bad request"`); the roster read is `member`-gated and skips dangling user refs. (mirrors `project_service.py:308-334`) |
| AC-O8 | `teams` is a per-org collection (`organizationId`, `name`, `memberIds:[str]`); team members must be org members; team `name` is unique within the org. (§4.2) |
| AC-O9 | Assigning a team to a project fans out to per-user project memberships via the existing `add_member` path, leaving `can_access` semantics unchanged; deleting a team cascade-strips it from project links and task `assigneeTeamIds`. (builds on `project_service.py:219-249`) |
| AC-O10 | A `@team` mention expands to current `memberIds` at fan-out time, then each resolved user passes the existing per-recipient mention guard (exists, project member, not author); non-member team members are skipped silently. (cross-ref [`collaboration-notifications.md`](collaboration-notifications.md)) |
| AC-O11 | `invitations` is a pending collection (`token`, `email`, `role`, `scope ∈ {org, project}`, `targetId`, `invitedBy`, `expiresAt`, `status`); the token is stored hashed and is the accept lookup key, never the `_id`. (§5.2) |
| AC-O12 | Invite-by-email works for a **not-yet-registered** person: accept-on-signup consumes the matching `pending` invite(s) and writes the membership, closing the "target must already exist" gap. (closes `project_service.py:236`) |
| AC-O13 | Invite-accept binds the membership to the authenticated/just-registered account whose **verified** email matches the invite; a mismatched or expired token → `"Bad request"`; a second accept is idempotent. (§5.3) |
| AC-O14 | Email verification exists (`emailVerified` on `User`; request/confirm token endpoints); registration is otherwise unchanged. (extends `auth_service.py:27-88`) |
| AC-O15 | Password reset backs the existing FE `forgotPassword` page: `password-reset/request` always returns `200` (anti-enumeration, like login), emails a token only for a real user, and `password-reset/confirm` re-hashes via `encrypt_password`. (backs `src/pages/forgotPassword/`; reuses `security.py:38-46`, preserves `auth_service.py:118-122`) |
| AC-O16 | A `guest` role is added below `viewer` (`ROLE_RANK[guest]=0`); every existing `min_role` write gate (`editor`+) automatically excludes guests because `guest < viewer < editor`. (extends `project_service.py:18-22`, `56-81`) |
| AC-O17 | `share_tokens` enables public READ-ONLY board/task access via an **unauthenticated** token-gated `GET` path that does not call `current_user_payload`; there is **no** token-authenticated write endpoint. (new path; contrast `security.py:154-176`) |
| AC-O18 | The public share path is a polling snapshot — **not** real-time, **not** CRDT/Yjs — consistent with the as-built no-push model and the platform exclusions. (cross-ref [`core-collaboration.md`](core-collaboration.md) N3, [`v2.1-agent.md`](v2.1-agent.md)) |
| AC-O19 | Mint/revoke of share tokens is project-`owner`-gated; a revoked or expired token is rejected on the public read path. (§6.3, §6.5) |
| AC-O20 | `User` gains `displayName`, `avatar`, `timezone`, `locale`, added to both `TABLE_FIELDS[users]` and the `USER_UPDATE_FIELDS` self-service allowlist; **no** privilege field is ever added to that allowlist. (extends `repositories.py:11-19`; honors `user_service.py:9-12`) |
| AC-O21 | The Account/Profile surface is the **first** FE caller of `PUT /users`, enabling in-app username/email/password and profile edits (none possible today). (`users.py:22-43`; `settings.tsx` has no account surface) |
| AC-O22 | Account deletion exists as self-only `DELETE /users` (soft-delete + anonymize); it is guarded against the last `org_owner` of a non-empty org and requires `managerId` reassignment for an owned project. (new; builds on `project_service.py:321-324`) |
| AC-O23 | Every new endpoint follows the collection-root + id-in-body (PUT) / id-in-query (DELETE/GET) convention with string-sentinel → HTTP mapping (Bad request→400, Forbidden→403, not found→404). (mirrors `validation.py`, `projects.py`) |
| AC-O24 | Multi-tenant model-key management is **not** introduced: the deployment retains one provider key; orgs are an identity/tenancy boundary only. (cross-ref [`v2.1-agent.md`](v2.1-agent.md) N1) |

---

## 10. Open Questions, Rollout & Dependencies

### 10.1 Open questions

| ID | Question | Leaning |
| --- | --- | --- |
| OQ-1 | Multi-org membership — should a user belong to many orgs (with an org switcher), or is one-org-per-user simpler for v1? | Multi-org (the switcher in §3.7 assumes it); single-org is a strict subset if we defer. |
| OQ-2 | When an org member is removed (§3.6), should their per-project and team memberships cascade-strip, or remain until manually cleared? | v1 leaves them (least-surprise, avoids a wide cascade across the tenancy boundary); revisit with the audit work (M8). |
| OQ-3 | When a team's `memberIds` change after it was assigned to a project, do we re-sync the per-user project memberships, or is assignment a one-time fan-out? | One-time fan-out in v1 (simpler, predictable); record the link so re-sync is a later opt-in. |
| OQ-4 | Should `GET /projects` return only the active org's projects, or the union across the caller's orgs (with the org switcher narrowing client-side)? | Union, scoped+indexed by the caller's org memberships (§3.5); the switcher filters the result. |
| OQ-5 | Logout-everywhere / true session revocation needs a `jti`/token-version denylist atop stateless HS256 JWTs (`security.py:89-97`) — in scope for §7.4 or deferred? | Deferred; document the attach point now, ship change-password + soft-delete first. |
| OQ-6 | Email delivery — which provider/transport backs invitations, verification, and reset? Is a dev-mode "log the link" path acceptable until one is wired? | Dev-mode log-the-link for the first cut; pluggable sender behind an interface, since no email infra exists today. |
| OQ-7 | Should `guest` be allowed to comment by default, or read-only unless explicitly granted? | Read-only by default; comment-create only when the project opts in (keeps `guest` genuinely low-trust). |

### 10.2 The single-tenant full-scan listing (mandatory rollout interaction)

The as-built `GET /projects` performs a **full scan of all projects** filtered in Python (`project_service.py:140-150`) — an explicit single-tenant shortcut. Introducing `organizationId` (§3) **requires** revisiting it: the listing must filter by the caller's org membership(s) at the query layer *before* the Python `can_access` pass. This is both a performance fix (bounded scan) and a correctness/isolation fix (no cross-tenant candidate set ever materializes). It is a hard dependency of org rollout, not a nice-to-have, and it must land in the same milestone that ships `organizationId` scoping.

### 10.3 Rollout & dependencies

| Phase | Scope | Depends on | Notes |
| --- | --- | --- | --- |
| R1 | `organizations` entity + org roles + `can_access_org`; `projects.organizationId` added to the allowlist; the string→entity **migration** (§3.4). | as-built RBAC (`project_service.py`); `validate_fields` widening (`repositories.py:143-147`). | Dual-write window keeps `organization` readable; nothing else can land first. |
| R2 | Org-scoped + **indexed** project listing (§3.5/§10.2); org settings + Members UI (the first role-rendering surface). | R1. | Closes the full-scan/cross-tenant interaction. Indexes per §10.4. |
| R3 | `teams` (§4): collection, endpoints, project-assign fan-out, `@team` expansion, `assigneeTeamIds` on `tasks`. | R1; @mention producer ([`collaboration-notifications.md`](collaboration-notifications.md)); task fields ([`work-management-depth.md`](work-management-depth.md)). | Org-scoped, so strictly after R1. |
| R4 | `invitations` (§5) incl. email **verification** + password **reset**; pluggable email sender; register/login accept-bridge; wire `forgotPassword`. | R1 (org-scope invites); email transport (OQ-6). | Unblocks onboarding outsiders; closes `project_service.py:236`. |
| R5 | `guest` role + `share_tokens` + the unauthenticated public read path (§6). | as-built `can_access`; R4 for guest invites. | Read-only / non-real-time hard boundary. |
| R6 | Account/profile (§7): `User` profile fields, the first `PUT /users` FE caller, account deletion + guards, session/security basics. | as-built `PUT /users` (`users.py`); R1 for last-`org_owner` guard. | Independent of R3–R5; can run in parallel after R1. |
| Deferred | Admin AI-gating dashboard (**M6**), org-wide audit history (**M8**), export/webhooks (**M7**); the platform horizon (§8: SSO/OIDC, SCIM, PATs/public API, billing/seats). | — | Cross-referenced as out-of-scope here; tracked in [`../todo/feature-build-progress.md`](../todo/feature-build-progress.md). |

### 10.4 Index needs

Net-new indexes the tenancy/identity model requires (the as-built app relies on `_id` lookups + Python filtering, so these are additive):

- `projects.organizationId` — the org-scoped listing (§3.5).
- `organizations.members.userId` — "which orgs does this user belong to" for the switcher/listing union.
- `organizations.slug` — **unique**, backing the slug uniqueness check.
- `teams.organizationId` — list-teams-in-org.
- `invitations.token` (**unique**) and `invitations.email` — accept lookup + per-email pending scan; an `expiresAt` TTL index sweeps expired rows.
- `share_tokens.token` (**unique**) and `share_tokens.projectId` — public read lookup + per-project revocation.
- `auth_tokens.token` (**unique**) + `expiresAt` TTL — verification/reset lookup + sweep.

---

## Appendix A — Endpoint reference

Every proposed endpoint. All except the public read path require a valid REST JWT (`security.py` §3.1 of [`core-collaboration.md`](core-collaboration.md)); the **Required role** column is the *additional* per-resource altitude. New collections only — the as-built collaboration endpoints are owned by [`core-collaboration.md`](core-collaboration.md) Appendix A. Org roles: `org_owner > org_admin > member`. Project roles (existing, `guest` added): `owner > editor > viewer > guest`.

| Method | Path | Required role | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/organizations/` | authenticated | Create org (creator seeded `org_owner`) |
| `GET` | `/api/v1/organizations/` | `member` (per org) | List caller's orgs, or one by `?organizationId` |
| `PUT` | `/api/v1/organizations/` | `org_admin` | Update `{name, slug, settings}` (not `members`) |
| `DELETE` | `/api/v1/organizations/` | `org_owner` | Delete org (refused while it owns projects) |
| `GET` | `/api/v1/organizations/members` | `member` | Org roster `[{_id, username, email, role}]` |
| `POST` | `/api/v1/organizations/members` | `org_admin` | Add/upsert an existing user (last-owner guard) |
| `PUT` | `/api/v1/organizations/members` | `org_admin` | Change org member role (last-owner guard) |
| `DELETE` | `/api/v1/organizations/members` | `org_admin` | Remove org member (last-owner guard) |
| `POST` | `/api/v1/organizations/projects` | `org_admin` (both) | Move a project between orgs (re-scope) |
| `GET` | `/api/v1/teams/` | `member` (org) | List org teams (`?organizationId`) or one (`?teamId`) |
| `POST` | `/api/v1/teams/` | `org_admin` | Create team (`{organizationId, name}`; unique-in-org) |
| `PUT` | `/api/v1/teams/` | `org_admin` | Rename / set `memberIds` (org members only) |
| `DELETE` | `/api/v1/teams/` | `org_admin` | Delete team; cascade-strip from projects + tasks |
| `POST` | `/api/v1/teams/assign` | `editor` (project) + `member` (org) | Assign team to project; fan out to memberships |
| `POST` | `/api/v1/invitations/` | `org_admin` / project `owner` | Create + email invite (`scope ∈ org|project`) |
| `GET` | `/api/v1/invitations/` | `org_admin` / project `owner` | List pending invites for an org/project |
| `POST` | `/api/v1/invitations/accept` | authenticated | Consume `{token}`; attach membership (verified-email match) |
| `DELETE` | `/api/v1/invitations/` | inviter w/ gating role | Revoke invite (`?invitationId`) |
| `POST` | `/api/v1/auth/verify-email/request` | authenticated | Mint + email a verification token |
| `POST` | `/api/v1/auth/verify-email/confirm` | token-gated | `{token}` → set `emailVerified=true` |
| `POST` | `/api/v1/auth/password-reset/request` | unauthenticated | `{email}` → always 200; email token only if real (anti-enum) |
| `POST` | `/api/v1/auth/password-reset/confirm` | token-gated | `{token, password}` → re-hash + store (single-use) |
| `POST` | `/api/v1/share-tokens/` | project `owner` | Mint public read token (`{projectId, scope, targetId, expiresAt?}`) |
| `GET` | `/api/v1/share-tokens/` | project `owner` | List a project's share tokens (`?projectId`) |
| `DELETE` | `/api/v1/share-tokens/` | project `owner` | Revoke share token (`?shareTokenId`) |
| `GET` | `/api/v1/public/board` | **none** (token) | Read-only board snapshot (`?token`) |
| `GET` | `/api/v1/public/task` | **none** (token) | Read-only task snapshot (`?token`) |
| `PUT` | `/api/v1/users/` | self | Update `{username, email, password, displayName, avatar, timezone, locale}` |
| `DELETE` | `/api/v1/users/` | self | Soft-delete + anonymize own account (guards apply) |

---

## Appendix B — Data model

New and changed collections (per the `repositories.py` `TABLE_FIELDS` pattern). `password` is stripped on serialize; `createdAt`/`updatedAt` are repository-managed on every row; all token fields are stored **hashed** (raw tokens live only in emailed links / shared URLs). Unchanged collections (`columns`, `tasks` save the noted addition, `labels`, `comments`, `notifications`) are owned by [`core-collaboration.md`](core-collaboration.md) Appendix B.

| Collection | Fields |
| --- | --- |
| `organizations` *(new)* | `_id`, `name`, `slug` (unique), `members` (`[{userId, role}]`; roles `org_owner > org_admin > member`), `settings` (schemaless dict), `createdAt`, `updatedAt` |
| `teams` *(new)* | `_id`, `organizationId`, `name` (unique-in-org), `memberIds` (`[str]`, org members only), `createdAt`, `updatedAt` |
| `invitations` *(new)* | `_id`, `token` (hashed, unique), `email`, `role`, `scope` (`org` \| `project`), `targetId`, `invitedBy`, `expiresAt`, `status` (`pending` \| `accepted` \| `revoked` \| `expired`), `createdAt`, `updatedAt` |
| `share_tokens` *(new)* | `_id`, `token` (hashed, unique), `scope` (`board` \| `task`), `targetId`, `projectId`, `createdBy`, `expiresAt` (nullable), `revoked` (bool), `createdAt`, `updatedAt` |
| `auth_tokens` *(new)* | `_id`, `token` (hashed, unique), `userId`, `purpose` (`email_verify` \| `password_reset`), `expiresAt`, `consumed` (bool), `createdAt`, `updatedAt` |
| `projects` *(changed)* | `_id`, `projectName`, **`organizationId` (new; replaces `organization`)**, `organization` *(deprecated — read-only during the migration window, then dropped)*, `managerId`, `memberIds` (`[{userId, role}]`; `guest` role added below `viewer`), `createdAt`, `updatedAt` |
| `users` *(changed)* | `_id`, `username`, `email`, `password` (never serialized), **`displayName` (new)**, **`avatar` (new)**, **`timezone` (new)**, **`locale` (new)**, **`emailVerified` (new, bool)**, `likedProjects`, `createdAt`, `updatedAt` |
| `tasks` *(changed — one addition)* | …as-built ([`core-collaboration.md`](core-collaboration.md) Appendix B)… plus **`assigneeTeamIds` (new; `[str]`, team task-assignees)** |
