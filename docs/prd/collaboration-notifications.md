# PRD: Pulse — Collaboration & Notifications Depth

| Field | Value |
| --- | --- |
| Status | Draft v1 — proposed. Net-new completeness features that deepen collaboration and notifications on top of the as-built core; backend + frontend are both unbuilt unless a partial substrate is noted (see the status legend). |
| Author | Product / Engineering — completeness proposal |
| Last updated | 2026-06-04 |
| Target repository | `pulse` (frontend `src/`; backend `backend/`, FastAPI + MongoDB) |
| Document scope | the collaboration & notification *depth* layer — watchers/subscriptions, notification breadth and delivery channels, notification preferences, comment richness, a user-facing per-task activity timeline, and AI thread summarization — built strictly on top of the as-built core in [`core-collaboration.md`](core-collaboration.md), and explicitly scoped apart from the org-wide admin audit log (M8), real-time sync (M7), and attachments (M7). |
| Companion docs | [`work-management-depth.md`](work-management-depth.md), [`accounts-organizations.md`](accounts-organizations.md), [`core-collaboration.md`](core-collaboration.md) (the as-built substrate), [`v2.1-agent.md`](v2.1-agent.md), [`v3-ai-ux.md`](v3-ai-ux.md), [`../api/backend.md`](../api/backend.md), [`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) |

---

## 1. TL;DR / Overview

Pulse shipped a **complete, server-side collaboration core** — comments with @mentions, a user-scoped notification inbox, and rich tasks with primary + additional assignees — but the collaboration *experience* stops at the waterline of "the data model exists." Today a comment thread is flat (no replies, no reactions, no edit history), the notification inbox has exactly **one** producer (`"mention"`), notifications are **in-app only** (there is no email or web-push channel), there are **no per-user notification preferences**, there is **no way to follow a task you are not assigned to**, and there is **no persistent, user-facing record of what happened to a task** — the only journal in the tree is `agent_mutation_journal`, which is AI-scoped. This PRD is the proposal that closes those gaps and turns the substrate into a collaboration product.

The grounding facts a reader must hold before §3:

1. **The collaboration backend is real but shallow.** `comments` (`backend/app/repositories.py:76-85`) and `notifications` (`repositories.py:86-96`) are fully wired and enforced, but each is the minimum viable shape. `comment_service.py:33-72` is the **sole** notification producer; it fans out one `"mention"` kind and embeds the **raw author id** into the `summary` string (`f"{author_id} mentioned you"`, `comment_service.py:62-67`) because there is no `actorId` field to carry it structurally. Every feature here either **extends** one of those collections or adds a **new** collection alongside them.
2. **There is almost no collaboration *frontend*.** There is **no comments UI at all** — `src/interfaces/comment.d.ts` declares `IComment` but has **zero consumers** (no hook, no component), so the Inbox "Mentions" section can only ever be fed by an AI/direct-API mention, never a user-authored one. Building the base comments UI is already tracked as ⬜ FE work in [`core-collaboration.md`](core-collaboration.md) §12; this document frames its richness features (§7) as **extending that still-unbuilt surface**, not re-speccing the base CRUD.
3. **Several adjacent features are already owned elsewhere and are deliberately DEFERRED, not duplicated.** The org-wide **admin audit history** is M8 — the per-task activity timeline in §8 is the *user-facing* task history and is scoped explicitly apart from it. **Attachments** (GridFS) and **real-time board sync** (SSE) are M7. **AI inbox triage** already exists in spec ([`v2.1-agent.md`](v2.1-agent.md) §7.8, [`v3-ai-ux.md`](v3-ai-ux.md) §7.2); the only net-new AI piece here (§9) is thread **summarization**, which reuses the existing `be.summarize` tool. And **Slack/Confluence/scheduled-digest dispatch** is explicitly out of scope — our delivery channel (§6) is **transactional per-event** email + web-push, not a digest (the boundary is [`v2.1-agent.md`](v2.1-agent.md) N8 / §13).

Everything below honours the as-built **Mongo-only / field-allowlist / sentinel→HTTP / collection-root-URL / RBAC** conventions of [`core-collaboration.md`](core-collaboration.md) §3. New fields are additive to `TABLE_FIELDS` (`repositories.py:10-97`); new collections follow the same `validate_fields` allowlist discipline; every new endpoint is collection-root with id-in-body for `PUT` and id-in-query for `DELETE`/`GET`, and every new mutation is gated by `can_access(project, user, min_role)`.

---

## 2. Context & Scope

### 2.1 Relationship to the substrate and the companion proposals

This is one of three **completeness** proposals that sit on the as-built core. The division of labour:

| Layer | Owning document | What it covers |
| --- | --- | --- |
| As-built collaboration & work-management core | [`core-collaboration.md`](core-collaboration.md) | Projects, RBAC, boards, tasks, labels, flat comments, the `"mention"`-only notification inbox — **the substrate this PRD extends** |
| Collaboration & notification **depth** | **this document** | Watchers, notification breadth + `actorId`, preferences, email/web-push delivery, comment richness, the user-facing per-task activity timeline, AI thread summarization |
| Work-management **depth** | [`work-management-depth.md`](work-management-depth.md) | Deeper task/board features (the companion work-item proposal) |
| Accounts & organizations | [`accounts-organizations.md`](accounts-organizations.md) | The org/team directory — **the source of the team/group entities** §7.4 mentions for `@team` mentions |

The relationship to the substrate is strictly **extension**: every collection this PRD touches already exists (or is added next to one that does), and the authorization, validation, and serialization rules are inherited verbatim from [`core-collaboration.md`](core-collaboration.md) §3, not redesigned.

### 2.2 Goals & Non-goals

**Goals**

- **G1 — Let people follow work they do not own.** A first-class watcher/subscription model (`tasks.watcherIds`, plus project-level watch) so notifications reach interested parties, not only assignees and mentionees (§3).
- **G2 — Make the inbox actually informative.** New notification `kind`s for the events that already happen silently (assignment, status change, due-soon, reply, membership change, mention-on-edit), and a structured `actorId` so the UI can render an actor avatar instead of parsing a raw id out of a `summary` string (§4).
- **G3 — Give users control over the noise.** Per-user, per-kind, per-channel preferences with quiet hours, stored on the user document, honoured by every producer and the delivery layer (§5).
- **G4 — Deliver out of the app.** A transactional per-event **email + web-push** delivery layer on `notification_service`, routed per-kind by the §5 preferences — explicitly **not** a digest and **not** Slack/Confluence (§6).
- **G5 — Make comments a real discussion surface.** Reactions, threaded replies, and edit history on `comments`, plus `@team` mentions, framed as extensions of the still-unbuilt comments UI (§7).
- **G6 — Give every task a truthful history.** A persistent, per-entity `activity` collection written from each service mutation, surfaced as a **user-facing** timeline on the task — distinct from, and deferring, the M8 admin audit log (§8).
- **G7 — Summarize long threads with AI.** A server-owned, suggest-only thread summarization that reuses the existing agent framework's `be.summarize`, without re-speccing the already-planned AI inbox triage (§9).

**Non-goals**

- **N1 — The org-wide admin audit log.** The §8 timeline is per-entity and user-facing; the cross-project, admin-grade, tamper-evident **audit history is M8** and is explicitly out of scope here. §8 calls out the boundary so the two are never conflated.
- **N2 — Attachments.** Comment/task file attachments are **M7** (GridFS) and are deferred; §7 names them as out-of-scope-here.
- **N3 — Real-time push of collaboration data.** Live board sync / SSE fan-out of these new notifications is **M7**. This PRD delivers via the existing on-demand read model plus the new out-of-app channels (§6); the in-app feed still refreshes on demand, not over a socket.
- **N4 — Slack / Confluence / scheduled-digest dispatch.** Each is a full OAuth integration and a **digest**, not a per-event transactional message; deferred per [`v2.1-agent.md`](v2.1-agent.md) N8 / §13. Our channel is transactional email + web-push only (§6).
- **N5 — Re-speccing the base comments UI or the AI inbox triage.** The base comment CRUD UI is ⬜ in [`core-collaboration.md`](core-collaboration.md) §12; the AI triage inbox is owned by [`v2.1-agent.md`](v2.1-agent.md) §7.8 / [`v3-ai-ux.md`](v3-ai-ux.md) §7.2. This document extends the former and reuses the latter, but re-specifies neither.
- **N6 — Re-architecting persistence.** The single-tenant Mongo-scan model is inherited as-is; new list endpoints are unpaginated full scans like their siblings, and indexing is noted as an extension point, not specified (§11).

### 2.3 Status legend

Each feature's `Current state` callout marks the **honest current substrate** with one of these glyphs.

| Symbol | Meaning |
| --- | --- |
| ✅ | **Shipped** — backend complete AND a working, user-reachable FE surface exists. |
| 🟡 | **Partial** — a real substrate exists (a model, one producer, or a session-only surface) but the feature is materially incomplete. |
| 🔧 | **Backend-only** — backend complete; NO FE surface (no hook, no component) consumes it. |
| ⬜ | **Planned** — not built; the section below proposes it net-new. |

---

## 3. Watchers / Subscriptions

### 3.1 Current state

There is **no subscription concept anywhere**. A task carries a single primary assignee `coordinatorId` and a list of additional `assigneeIds[]` (`repositories.py:45-67`), but **no `watcherIds`** — there is no way to follow a task you are not assigned to, and no way to stop following one you are. Notifications therefore only ever reach a recipient by an explicit @mention (`comment_service.py:33-72`); assignment, status changes, and comments on a task you care about generate **nothing** because (a) there is no producer for them (§4) and (b) there is no audience model to fan them out to. Project membership (`project.memberIds`, [`core-collaboration.md`](core-collaboration.md) §3) defines *who can access*, not *who wants to be told*.

### 3.2 Proposed model

**A new additive field on `tasks`:**

- **`watcherIds: [str]`** — a list of `userId` strings who have subscribed to the task. Default `[]`. Added to `TABLE_FIELDS[tasks]` (`repositories.py:45-67`) so `validate_fields` accepts it; validated like the existing `assigneeIds` (a list of strings, each must reference an existing `users` row at write time — mirroring `_id_list_error` in `task_service.py:77-88`).

**A new collection for project-level watch** (so "watch everything in this project" does not require touching every task):

- **`subscriptions`** — `_id`, `userId`, `projectId`, `scope` (`"project"`; reserved for future `"label"`/`"epic"` scopes), `createdAt`, `updatedAt`. A new entry in `TABLE_FIELDS` with the same allowlist discipline. A user with a `project`-scope subscription is treated as a watcher of **every** task in that project for fan-out purposes (resolved at notification time, §4.4).

**Auto-watch rules** (applied by the relevant service on the triggering mutation, idempotent — re-adding an existing watcher is a no-op):

- On **assignment** — when `task_service.create`/`update`/`bulk_update` sets a user as `coordinatorId` or adds them to `assigneeIds`, that user is auto-added to `watcherIds` (`task_service.py:149`, `:260`, `:387`).
- On **comment** — when `comment_service.create` files a comment, the author is auto-added to the task's `watcherIds` (`comment_service.py:71`).
- On **mention** — when an @mention lands, the mentioned (eligible) user is auto-added to the task's `watcherIds` (`comment_service.py:33-72`), so the person you pulled in keeps getting the thread.

A user may always **explicitly unwatch** (removing themselves from `watcherIds`, or deleting their `subscriptions` row), which suppresses auto-re-watch for that task until they take a new watch-triggering action.

### 3.3 Endpoints

Collection-root, id-in-body/query, gated through `can_access` exactly like the task and comment routers.

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/api/v1/tasks/watch` | `viewer` (on the task's project) | Add the **caller** (`userId` from the JWT `sub`, never the body — anti-spoof per [`core-collaboration.md`](core-collaboration.md) §3.1) to the task's `watcherIds`. Idempotent. Requires `taskId`. → `"Watching"`. `projectId` is **derived from the task** (like `comment_service.create`, `comment_service.py:85`), never trusted from the body. |
| `DELETE` | `/api/v1/tasks/watch` | `viewer` | Remove the caller from `watcherIds` (`?taskId=`). → `"Unwatched"`. Idempotent. |
| `POST` | `/api/v1/subscriptions` | `viewer` (on `projectId`) | Create/upsert a `project`-scope subscription for the caller. Idempotent. Requires `projectId`. → `"Subscribed"`. |
| `DELETE` | `/api/v1/subscriptions` | `viewer` | Delete the caller's subscription (`?projectId=&scope=`). → `"Unsubscribed"`. |
| `GET` | `/api/v1/subscriptions` | self only | The caller's own subscriptions (no params — a caller can never read another user's subscriptions, mirroring the notification read contract, `notifications.py:12-18`). |

Sentinel mapping is inherited verbatim: `"Forbidden"`→`403`, `"... not found"`/`None`→`404`, `"Bad request"`→`400` (`validation.py`). A non-member who tries to watch a task in a project they cannot access gets `"Forbidden"` because the underlying `can_access(project, user, viewer)` fails on the derived `projectId`.

### 3.4 UX / surface notes

- A **Watch / Unwatch toggle** on the task surface (the comments-bearing task panel, once the §7 comments UI lands) plus a **watcher avatar stack** — a small extension of the existing assignee-avatar rendering pattern (`src/components/taskModal`, `src/components/taskDetailPanel`).
- A **"Watching" filter** on the inbox so a user can see notifications that reached them *because they watch*, distinct from those that @mention them directly — the inbox already partitions by source (`src/pages/inbox.tsx` Mentions vs Activity), so this is a new partition, not a new page.
- Auto-watch is **silent**: it never itself produces a notification (you do not get told "you are now watching"); it only widens the audience for the §4 kinds.

### 3.5 Current state — ⬜ Planned

`tasks` has `coordinatorId` + `assigneeIds[]` but **no `watcherIds`** (`repositories.py:45-67`); there is no `subscriptions` collection and no watch affordance anywhere in `src/`. Entirely net-new.

---

## 4. Notification Breadth + `actorId`

### 4.1 Current state

The `notifications` collection exists and its consumer FE is fully shipped (the bell + inbox, [`core-collaboration.md`](core-collaboration.md) §9.5), but the **producer side is a single thread**: `notification_service.create(user_id, kind, ref_id, summary, project_id)` (`notification_service.py:13-39`) is internal-only (no `POST` endpoint), and the **only** caller is the @mention fan-out in `comment_service.py:62-67`, which always passes `kind="mention"`. Two structural shortfalls follow:

- **No `actorId`.** The "who did this" is **smuggled into the `summary` string** as a raw id — `f"{author_id} mentioned you"` (`comment_service.py:62-67`). The FE cannot render an actor avatar/name without string-parsing, and the id is not even resolvable to a display name structurally. The `notifications` allowlist (`repositories.py:86-96`) has `userId`, `kind`, `refId`, `projectId`, `summary`, `isRead` — but **no `actorId`**.
- **Silent mutations.** Assignment, column moves, field edits (`task_service.py` `update`/`bulk_update`), membership changes (`project_service.py`), and comment replies all happen with **no notification emitted and no record written** ([`core-collaboration.md`](core-collaboration.md) §6, §8). The events users most want to hear about are exactly the ones that produce nothing today.

### 4.2 Proposed model — new producer kinds

Extend the **set of `kind` values** the existing producer emits (the `kind` field is deliberately free-form and built to extend — `notification_service.py:13-26`, [`core-collaboration.md`](core-collaboration.md) §9.2). No schema change is needed for the kinds themselves; the change is **new producer call-sites** plus the §4.3 `actorId` field. The new kinds and their producers:

| `kind` | Produced when | Producer site | Audience (after §3) |
| --- | --- | --- | --- |
| `mention` (existing) | An @mention lands on a comment | `comment_service.py:62-67` | The mentioned eligible user |
| `assignment` | A user becomes `coordinatorId` or is added to `assigneeIds` | `task_service.update`/`create`/`bulk_update` (`task_service.py:149`, `:260`, `:387`) | The newly-assigned user |
| `mention_on_edit` | A comment edit **adds a new** mention not present before | `comment_service.update` (`comment_service.py:134-156`) | The newly-added mentionee only (never re-spams prior mentionees — see note) |
| `due_soon` | A task's `dueDate` enters the "soon" window | a scheduled sweep (§4.5) | Watchers + assignees of the task |
| `status_change` | A task moves columns (its `columnId` changes) | `task_service.update`/`reorder` (`task_service.py:260`, `:329`) | Task watchers (§3) |
| `comment_reply` | A reply is filed under a comment (a `parentCommentId` is set, §7.2) | `comment_service.create` | Watchers + the parent comment's author |
| `membership_change` | A user is added / role-changed / removed on a project | `project_service` member mutations (`/api/v1/projects/members`) | The affected user (and optionally project owners) |

**Important — `mention_on_edit` and the no-re-spam invariant.** Today comment edits **deliberately do not re-process mentions** so recipients are never re-spammed (`comment_service.py:134-156`, [`core-collaboration.md`](core-collaboration.md) §8.3). This PRD preserves that guarantee precisely: on edit, the producer computes the **set difference** (new `mentions` minus the original `mentions`) and notifies **only the newly-added** users with `mention_on_edit`. Users already mentioned in the original comment are **never** re-notified. This requires the edit path to read the stored `mentions` before overwriting, and to re-run the existing eligibility checks (`_notify_mentions`, `comment_service.py:33-68`: target exists, is a member via `can_access(project, viewer)`, is not the author).

### 4.3 Proposed model — the `actorId` field

**Add `actorId: str` to `TABLE_FIELDS[notifications]`** (`repositories.py:86-96`) — the `userId` of the actor who caused the notification (the commenter, the assigner, the member-mutator). Optional (system-originated notifications, e.g. `due_soon`, may omit it / set it to a system sentinel). The producer signature becomes:

- **`notification_service.create(user_id, kind, ref_id, summary, project_id=None, actor_id=None)`** — `actor_id` is persisted on the row. The `summary` is **demoted to a human-readable fallback**; the FE renders the actor from `actorId` (resolved to a username via the existing user directory, `GET /users/members`) rather than parsing the id out of `summary`. This is backward-compatible: existing rows without `actorId` still render via their `summary`, and the existing `"{author} mentioned you"` summary stays as the fallback string while `actorId` becomes the structured source of truth.

This also fixes a latent leak-of-shape issue: the raw author id is currently visible in `summary` text; with `actorId` structured, the FE controls exactly how the actor is displayed.

### 4.4 Audience resolution & grouping

- **Audience resolution.** For each producing event, the producer assembles the recipient set = **explicit targets** (mentionee, assignee, affected member) **∪ task watchers** (`tasks.watcherIds`, §3) **∪ project subscribers** (`subscriptions` where `projectId` matches and `scope=="project"`, §3.2), then applies the standard **exclusions**: never notify the actor about their own action, never notify a non-member (re-run `can_access(project, user, viewer)`), de-duplicate so one user gets at most one row per event. This generalises the exact eligibility pattern already in `_notify_mentions` (`comment_service.py:51-68`) from one kind to all.
- **Grouping / collapse.** Notifications are **grouped in the FE** by `(kind, refId)` so "3 comments on TASK-12" collapses to one expandable row rather than three. Grouping is a **read-side** concern (the inbox renders the collapse); the stored rows remain one-per-event so mark-read granularity is preserved. An optional server-side `groupKey` (derived `f"{kind}:{refId}"`) MAY be added to `notifications` later to make grouping deterministic across clients; v1 derives it client-side to avoid a migration.

### 4.5 The `due_soon` sweep

`due_soon` is the one kind with **no user-action trigger**; it needs a periodic sweep (the same class of mechanism the AI triage uses — [`v2.1-agent.md`](v2.1-agent.md) §7.8 runs `be.detectDrift` on a schedule). A server-side job scans tasks whose `dueDate` (an ISO string, `repositories.py:56`, `task_service.py:63-75`) falls inside a "soon" window (e.g. due within 24h and not `Done`), and emits one `due_soon` per (watcher/assignee, task) per window, **idempotently** (a per-(userId, taskId, window) guard prevents re-emitting the same warning every sweep). This is **transactional-per-event**, not a digest (§6) — each crossing produces its own notification.

### 4.6 UX / surface notes

- The inbox (`src/pages/inbox.tsx`) gains a **per-kind icon + actor avatar** on each row (from `actorId`), grouped rows with a count badge, and per-kind filtering. The existing Mentions section becomes one filter among the new kinds.
- The notification bell badge (`src/components/notificationBell`, `useNotifications`) counts unread across **all** kinds, not just mentions; `unreadCount` derivation (`!isRead`) is unchanged.

### 4.7 Current state — 🟡 Partial

The `notifications` model and its consumer FE exist and are shipped, but there is **exactly one producer** (`"mention"`, `comment_service.py:62-67`), **no `actorId`** (the author id is embedded in `summary`, `repositories.py:86-96`), and **no grouping**. The model is real; the breadth is not.

---

## 5. Notification Preferences

### 5.1 Current state

There are **no notification preferences of any kind**. Every produced notification is delivered unconditionally to its recipient's inbox; a user cannot mute a kind, opt out of a channel (there is only one channel — in-app), or set quiet hours. The `users` collection (`repositories.py:11-19`) has `username`, `email`, `password`, `likedProjects` — and **no preferences field**. On the FE, `PUT /users` has **no caller at all**, and `settings.tsx` exposes only theme / language / AI-toggle / logout — there is **no notification-preferences surface** to wire to.

### 5.2 Proposed model

**Add `notificationPrefs` (an embedded object) to `TABLE_FIELDS[users]`** (`repositories.py:11-19`). A nested, schemaless-friendly document (the store is schemaless dicts; only the **top-level** `notificationPrefs` key needs to be allowlisted, and `validate_fields` checks only top-level keys — `repositories.py:143-147`). Shape:

- **`notificationPrefs.byKind`** — a map of `kind` → `{ inApp: bool, email: bool, webPush: bool }`, e.g. `{ "assignment": { "inApp": true, "email": true, "webPush": false }, ... }`. A missing kind defaults to **all channels on** (notify by default; muting is opt-in), so the absence of prefs preserves today's behaviour.
- **`notificationPrefs.quietHours`** — `{ enabled: bool, start: str, end: str, tz: str }` (HH:MM 24h strings + an IANA tz). During quiet hours, **out-of-app** channels (email/web-push) are suppressed; **in-app** is always written (the inbox is a passive surface, so quiet hours never hide a row, only the push). A suppressed-by-quiet-hours notification is still **persisted in-app**, so nothing is lost — the user simply reads it when they return.

Validation lives in a new `_prefs_error` helper on the user service, mirroring the defensive validators in `task_service.py` (`_story_points_error`, `_date_error`): channel flags must be booleans, `quietHours` times must be `HH:MM` strings, unknown channel keys are rejected.

### 5.3 Endpoints

No new endpoint is strictly required — `notificationPrefs` is a field on `users` and rides the **existing** `PUT /api/v1/users` (self-only, [`core-collaboration.md`](core-collaboration.md) Appendix A "own profile"). For clarity and a tighter validation surface, this PRD adds a dedicated sub-route:

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `GET` | `/api/v1/users/notification-prefs` | self only | Return the caller's `notificationPrefs` (defaults materialised for any missing kind). No params — the caller can only read their own (mirrors `notifications.py:12-18`). |
| `PUT` | `/api/v1/users/notification-prefs` | self only | Patch the caller's `notificationPrefs`. Body validated by `_prefs_error` → `"Bad request"` on a malformed flag/time. → `"Preferences updated"`. Writes only `notificationPrefs` on the caller's own user row (the JWT `sub`, never a body `userId`). |

### 5.4 Enforcement — every producer and the delivery layer consult prefs

Preferences are enforced in **two** places so neither path can leak around them:

- **At the producer** (`notification_service.create`): before writing an in-app row for `kind` K to user U, check `U.notificationPrefs.byKind[K].inApp` — if `false`, the in-app row is suppressed for that user (the rest of the fan-out is unaffected).
- **At the delivery layer** (§6): channel routing reads `byKind[K].email` / `byKind[K].webPush` and `quietHours` to decide which out-of-app channels fire.

Because the producer already iterates an eligible-recipient set per event (§4.4), the prefs check is a per-recipient filter inside that existing loop — the same shape as the `can_access` eligibility check already in `_notify_mentions` (`comment_service.py:51-68`).

### 5.5 UX / surface notes

- A **Notifications** section in `settings.tsx` (today: theme / language / AI-toggle / logout only): a per-kind matrix of in-app / email / web-push toggles, plus a quiet-hours editor. This is the **first** FE caller of a `PUT /users`-family write (there is none today).
- Sensible defaults render even before a user touches the page (every kind on, quiet hours off), so the surface is informative on first visit.

### 5.6 Current state — ⬜ Planned

`users` has **no `notificationPrefs`** (`repositories.py:11-19`); `settings.tsx` has no notification surface and `PUT /users` has no FE caller. Entirely net-new (the only reuse is the existing self-only `users` write path).

---

## 6. Delivery Channels — Email & Web-Push

### 6.1 Current state

Notifications are **strictly in-app only** ([`core-collaboration.md`](core-collaboration.md) §9). `notification_service.create` writes a Mongo row and nothing else (`notification_service.py:13-39`) — there is **no email, no web-push, no outbound dispatch of any kind**, no SMTP/push configuration, and no delivery record. The inbox is read on demand (`GET /notifications`, newest-first, unpaginated, `notification_service.py:42-60`); a user who is not looking at Pulse learns about nothing.

### 6.2 Proposed model — a delivery layer on `notification_service`

Introduce an **outbound delivery layer** invoked **immediately after** each in-app row is written, for the **same event**, routed per-kind by the §5 preferences. The channels:

- **Transactional email** — one email **per event** (e.g. "Maya assigned you TASK-12"), rendered from the notification's `kind` + `actorId` + `refId` + `summary`. **Not** a digest, **not** batched, **not** scheduled.
- **Web-push** — a browser push for the same event, via the standard Web Push protocol (a new `pushSubscriptions` collection holds each browser's push endpoint + keys per user; the FE registers a service-worker subscription and posts it).

**New supporting collections** (each added to `TABLE_FIELDS` with the allowlist discipline):

- **`pushSubscriptions`** — `_id`, `userId`, `endpoint`, `keys` (`{p256dh, auth}`), `createdAt`, `updatedAt`. One row per registered browser; a user may have several.
- **`deliveries`** — `_id`, `notificationId`, `userId`, `channel` (`"email"` | `"webPush"`), `status` (`"queued"` | `"sent"` | `"failed"`), `error` (optional), `createdAt`, `updatedAt`. A delivery **audit row per channel attempt**, so a failed send is visible and retryable, and a notification's out-of-app fate is traceable (this is a delivery ledger, **not** the §8 activity timeline and **not** the M8 audit log).

**Channel routing** (per recipient, per event):

1. Write the in-app row (subject to `byKind[K].inApp`, §5.4).
2. For each out-of-app channel C in `{email, webPush}`: fire C **iff** `byKind[K][C]` is true **and** not currently within the recipient's `quietHours` (§5.2). Quiet hours suppress out-of-app channels only; the in-app row is already written.
3. Record a `deliveries` row per attempted channel; on transient failure, the queue retries with backoff (idempotency keyed on `(notificationId, channel)` so a retry never double-sends).

### 6.3 Endpoints

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/api/v1/push-subscriptions` | self only | Register the caller's browser push subscription (`endpoint` + `keys` from the service worker). Idempotent on `endpoint`. → `"Subscribed"`. The `userId` is the JWT `sub`, never the body. |
| `DELETE` | `/api/v1/push-subscriptions` | self only | Remove a subscription (`?endpoint=`) — e.g. on logout or unsubscribe. → `"Unsubscribed"`. |

There is **no endpoint to trigger a delivery** — deliveries are an **internal** side effect of `notification_service.create`, exactly as the in-app write is internal today (`notification_service.py:13-39`, no `POST /notifications`).

### 6.4 Explicitly excluded — Slack / Confluence / scheduled digest

This delivery layer is **transactional per-event** only. The following are **out of scope** and must not be proposed here:

- **Scheduled digest dispatch** (a periodic rollup email) — our email is one-per-event, not a digest.
- **Slack** and **Confluence** dispatch — each is a **full OAuth integration feature** (channel/space picker, webhook/page management) and is **deferred**, per [`v2.1-agent.md`](v2.1-agent.md) **N8** and **§13** (`be.scheduleDigest` / `be.dispatchDigest` to Slack/Confluence are listed there as deferred OAuth features). Citing that boundary is deliberate: per-event email + web-push is a delivery primitive; a digest to a third-party workspace is a different, larger feature owned elsewhere.

### 6.5 UX / surface notes

- A **"Enable browser notifications"** affordance in the §5 settings surface that requests the Notification permission and registers the service-worker push subscription (posting to `POST /push-subscriptions`).
- Email rendering reuses the structured `actorId`/`kind`/`refId` (§4) so the email body is consistent with the in-app row; each email deep-links to the referenced task's board (the same deep-link target the inbox uses today, `/projects/{projectId}/board`, [`core-collaboration.md`](core-collaboration.md) §9.5).
- Per-channel state (sent/failed) from `deliveries` MAY surface a subtle "couldn't email you" hint in settings; v1 keeps it server-side for retry only.

### 6.6 Current state — ⬜ Planned

In-app only (`notification_service.py:13-39`); there is **no outbound channel, no `pushSubscriptions`, no `deliveries`**. The email/web-push infrastructure is a **new outbound dependency** for the repo (§11). Entirely net-new.

---

## 7. Comment Richness

### 7.1 Current state

Comments are **flat and minimal**. The `comments` collection is `_id`, `taskId`, `projectId`, `authorId`, `body`, `mentions`, `createdAt`, `updatedAt` (`repositories.py:76-85`) — there is **no `parentCommentId`** (no threading), **no reactions**, **no `editedAt`** or edit history (an edit overwrites `body` and bumps `updatedAt` only, `comment_service.py:134-156`), and **no attachments**. Comments exist **only on tasks** (`comment_service.create` derives `projectId` from the task, `comment_service.py:80-88`). And critically, there is **no comments UI at all**: `IComment` (`src/interfaces/comment.d.ts`) has **zero consumers** — no `useComments` hook, no comment component — so the base comment thread is itself unbuilt (tracked ⬜ in [`core-collaboration.md`](core-collaboration.md) §12). This section **extends that still-unbuilt base UI**, not the base CRUD.

### 7.2 Proposed model — threading, reactions, edit history

**Additive fields on `comments`** (`repositories.py:76-85`):

- **`parentCommentId: str | null`** — the `_id` of the comment this is a reply to, or `null` for a top-level comment. Default `null`. Validated like `parentTaskId` on tasks (`task_service.py:109-135`): the parent must **exist**, must belong to the **same task** (`taskId` match, not just same project), and must **not be self**. **One level of nesting only** — a reply to a reply re-parents to the top-level comment of the thread (mirroring the deliberate single-level design of sub-tasks, [`core-collaboration.md`](core-collaboration.md) §6.4). A reply emits the `comment_reply` notification (§4.2) to the parent author + watchers.
- **`reactions: { emoji: [userId] }`** — a map of emoji shortcode → list of `userId` who reacted (e.g. `{ "+1": ["u1","u2"], "tada": ["u3"] }`). Default `{}`. A user may add or remove their own reaction; a reaction is **idempotent** (re-adding is a no-op) and a user appears at most once per emoji.
- **`editedAt: str | null`** and **`revisions: [{ body, editedAt }]`** — `editedAt` is set on the first edit; each edit **appends the prior `body`** (with its timestamp) to `revisions` before overwriting `body`. Default `editedAt=null`, `revisions=[]`. This makes edits **visible and auditable** ("edited" indicator + a revision viewer) without changing the author-only edit rule ([`core-collaboration.md`](core-collaboration.md) §8.1) or the no-re-spam mention invariant (§4.2).

Author/permission rules are **inherited unchanged** from [`core-collaboration.md`](core-collaboration.md) §8: create requires `viewer` on the task's project; **edit is author-only**; **delete is author OR project manager**. New mutations (react, reply) require `viewer` (participants too); a reaction is something any member can do.

### 7.3 Endpoints

Sub-routes under the existing `/api/v1/comments` collection root, same sentinel→HTTP mapping.

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/api/v1/comments` (extended) | `viewer` (task's project) | Create — now accepts optional `parentCommentId` (validated per §7.2). A reply emits `comment_reply` (§4). |
| `POST` | `/api/v1/comments/reactions` | `viewer` | Add the caller's reaction. Requires `_id` (comment), `emoji`. Idempotent. → `"Reaction added"`. |
| `DELETE` | `/api/v1/comments/reactions` | `viewer` | Remove the caller's reaction (`?commentId=&emoji=`). → `"Reaction removed"`. |
| `GET` | `/api/v1/comments/revisions` | `viewer` (task's project) | Return a comment's `revisions` + current `body` (`?commentId=`), oldest-first. |

The caller for reactions is always the JWT `sub` (never a body `userId`) — a user can only add/remove **their own** reaction, the same anti-spoof discipline as comment authorship (`comment_service.py:96-105`).

### 7.4 `@team` / group mentions

Today `mentions` is a list of **user** ids only, supplied explicitly in the body and not parsed server-side ([`core-collaboration.md`](core-collaboration.md) §8.3). This PRD extends mention targets to include **teams/groups** — but the **team entity itself is owned by [`accounts-organizations.md`](accounts-organizations.md)**, which introduces the org/team directory (there is **no `teams` collection in the tree today** — confirmed against `repositories.py:10-97`). The contract here is the **fan-out behaviour**: when a mention target is a team id, the producer **expands the team to its member userIds** (via the directory that companion provides), then runs the **identical per-user eligibility filter** already in `_notify_mentions` (`comment_service.py:51-68`): each expanded member must exist, be a project member (`can_access viewer`), and not be the author; ineligible members are skipped silently. The stored `mentions` may record the team id for display, with the expansion resolved at fan-out time. **This feature is gated on [`accounts-organizations.md`](accounts-organizations.md) shipping teams** (§11 dependency); the comment-side behaviour is specified here so the two proposals dovetail.

### 7.5 Attachments — deferred to M7

Comment (and task) **attachments are explicitly out of scope here** and deferred to **M7** (GridFS, [`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) M7). No `attachments` field is added to `comments` by this PRD; when M7 lands, an additive `attachmentIds[]` would slot in next to the §7.2 fields.

### 7.6 UX / surface notes

- These features **extend the unbuilt base comments UI** (⬜ in [`core-collaboration.md`](core-collaboration.md) §12): the `useComments` hook and thread component that section calls for would render replies as an indented one-level thread, an emoji reaction bar per comment, an "edited" indicator opening the revision viewer, and a mention composer that can target users **and** teams.
- The mention composer's team options come from the [`accounts-organizations.md`](accounts-organizations.md) directory; its user options from the existing project roster (`useProjectMembers`, [`core-collaboration.md`](core-collaboration.md) §4.5).

### 7.7 Current state — 🔧 Backend-only

The comments **backend exists** (`comment_service.py`, `repositories.py:76-85`) but is **flat** — no `parentCommentId`, no `reactions`, no `editedAt`/`revisions` — and has **NO FE UI** (`IComment` has zero consumers, [`core-collaboration.md`](core-collaboration.md) §8.5). Backend-only, and even the backend lacks the richness fields.

---

## 8. Per-Task Activity Timeline

### 8.1 Current state

There is **no per-entity change log**. A task write overwrites the changed fields and bumps `updatedAt` — and that is the **entire** history; the prior value is gone (`task_service.py` `update`/`bulk_update`, [`core-collaboration.md`](core-collaboration.md) §6). The **only** journal in the tree is **`agent_mutation_journal`** (`backend/app/services/agent_mutation_journal.py`), which stores a reverse-diff **per `(user_id, proposal_id)`** for AI undo — it is **AI-scoped** (only AI proposal applications write to it; fields `user_id, project_id, proposal_id, undo_diff, createdAt, undoneAt`) and is **not** a user-facing task history. A user looking at a task cannot see "who moved this to Done, and when."

### 8.2 Proposed model — a persistent `activity` collection

**A new collection `activity`**, written from **each service mutation** (a small append at the end of every `create`/`update`/`delete`/`reorder`/`bulk_update`/membership path). Fields (added to `TABLE_FIELDS`):

- **`_id`**
- **`entityType: str`** — `"task"` | `"comment"` | `"column"` | `"project"` | `"member"`.
- **`entityId: str`** — the affected entity's `_id`.
- **`projectId: str`** — the owning project (derived server-side, never trusted from a body — the same discipline as `comment_service.py:85`), so the timeline is project-scoped and `can_access`-gateable.
- **`actorId: str`** — the user who performed the mutation (the JWT `sub`).
- **`verb: str`** — `"created"` | `"updated"` | `"moved"` | `"assigned"` | `"commented"` | `"deleted"` | `"member_added"` | `"role_changed"` | `"member_removed"`, etc.
- **`before` / `after`** — the changed field(s)' prior and new values (a small diff, e.g. `{ "columnId": "<id>" }`), so the timeline reads "moved from In Progress to Done." Optional for create/delete verbs.
- **`createdAt`** (repository-managed).

Writes are **append-only** (no update/delete of an activity row through any API), so the timeline is an immutable record. Because the store is schemaless and the write is a single `insert_one`, the per-mutation cost is one extra insert; the allowlist (`validate_fields`) accepts the row because `activity` is in `TABLE_FIELDS`.

### 8.3 Endpoints

| Method | Path | Required role | Behaviour |
| --- | --- | --- | --- |
| `GET` | `/api/v1/activity` | `viewer` (on `projectId`) | The activity for one entity (`?entityType=&entityId=`) **or** a project feed (`?projectId=`), newest-first, unpaginated (same scan model as the other list endpoints, [`core-collaboration.md`](core-collaboration.md) §3). Gated by `can_access(projectId, user, viewer)`; a non-member → `"Forbidden"`. |

There is **no write endpoint** — activity rows are an **internal** side effect of the service mutations (exactly as notifications are produced internally, `notification_service.py:13-39`). A client can never forge an activity row.

### 8.4 Explicitly distinct from — and deferring — the M8 admin audit log

This timeline is the **user-facing, per-entity task history**: scoped to one project, gated at `viewer`, surfaced inline on the task. It is **NOT** the **org-wide admin audit history**, which is **M8** ([`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) M8: "org-wide audit history") — that is a cross-project, admin-grade, retention/tamper-evidence-oriented log with a different audience (org admins), a different access model, and different compliance requirements. The two are deliberately separate: this `activity` collection MAY later **feed** the M8 audit log, but its scope, gating, and surface are the per-task timeline only. Naming them apart here prevents the common conflation of "task history" with "audit log." (Note also that `activity` is distinct from the AI-only `agent_mutation_journal`, §8.1.)

### 8.5 UX / surface notes

- An **Activity timeline** on the task surface (the same task panel that will host comments, §7), interleaving system events ("moved to Done", "assigned to Priya", "due date set") with comments to form a single chronological story — the way a mature issue tracker shows a task's life.
- Note the **disambiguation already drawn** in [`core-collaboration.md`](core-collaboration.md) §9.4: the inbox's session-only **Activity** section (`useActivityFeed`, a Redux 50-entry FIFO cache that is **dropped on reload**, `src/utils/hooks/useActivityFeed.ts`) is a **client-only optimistic feed**, NOT this server-backed timeline. This PRD's `activity` collection is the **persistent** record; the existing `useActivityFeed` remains a transient UI nicety. The two must not be conflated.

### 8.6 Current state — ⬜ Planned

Only `updatedAt` is overwritten per write (`task_service.py`); the sole journal is the **AI-only** `agent_mutation_journal` (`agent_mutation_journal.py`). There is **no `activity` collection** and **no user-facing task timeline**. Entirely net-new.

---

## 9. AI-Assisted Collaboration

### 9.1 Current state

The AI layer **already covers inbox triage**. The `triage-agent` generates proactive drift **nudges** into the AI Triage Inbox ([`v2.1-agent.md`](v2.1-agent.md) §7.8: ≤5 active nudges/board, 4h expiry, aggregation/decay) and the [`v3-ai-ux.md`](v3-ai-ux.md) §7.2 Inbox tab renders them. That is a **different inbox** from the notification Mentions inbox ([`core-collaboration.md`](core-collaboration.md) §9.4 draws the disambiguation explicitly). **This PRD does not re-spec AI triage** — it already exists in the AI PRDs. The agent framework also already exposes a server-side summarization tool, **`be.summarize`** ([`v2.1-agent.md`](v2.1-agent.md) §5 tool catalog: "Long-text summarisation"), used today for board briefs.

### 9.2 Proposed — AI thread summarization (the net-new piece)

The single net-new AI collaboration feature is **comment-thread summarization**: for a long comment thread on a task (once §7 threading + the comments UI exist), offer a **server-owned, suggest-only** "Summarize this thread" action that condenses the discussion into a few lines ("Decision: ship behind a flag; Priya owns the migration; open question: data backfill").

- **Server-owned & suggest-only.** The summary is generated server-side via the **existing `be.summarize` tool within the existing agent framework** ([`v2.1-agent.md`](v2.1-agent.md) §5) — no new agent, no new transport, no autonomy dial. It is **suggest-only**: the summary is presented for reading; it is **never** persisted as a comment, never mutates the thread, and requires no accept/apply step (mirroring the read-only, suggest-only posture of the existing brief/estimate surfaces).
- **Grounding & access.** The summarizer reads only the thread's own comments (already `viewer`-gated via `comment_service.get`, `comment_service.py:116-131`); it inherits the per-project AI-enabled gate the rest of the agent layer uses ([`v2.1-agent.md`](v2.1-agent.md)).
- **No new collection.** Because it is suggest-only and ephemeral, there is nothing to store; the summary is returned to the FE and rendered transiently (it may be re-requested). This keeps the feature inside the existing agent request/response shape rather than adding a notification kind or an `activity` verb.

### 9.3 UX / surface notes

- A **"Summarize thread"** affordance on a long comment thread (a threshold, e.g. ≥ N comments) within the §7 comments UI, rendering the AI summary in a transient, clearly-labelled "AI summary (not saved)" block — consistent with the suggest-only AI surfaces of [`v3-ai-ux.md`](v3-ai-ux.md).
- It reuses the existing AI right-rail/agent plumbing; it adds **no** new top-level AI surface (the unified Copilot rail is M5, [`../todo/feature-build-progress.md`](../todo/feature-build-progress.md)).

### 9.4 Current state — 🟡 Partial

AI **inbox triage already exists** ([`v2.1-agent.md`](v2.1-agent.md) §7.8, [`v3-ai-ux.md`](v3-ai-ux.md) §7.2) and the **`be.summarize` tool already exists** ([`v2.1-agent.md`](v2.1-agent.md) §5); the net-new thread-summarization **action over comment threads** is unbuilt (and depends on §7's threaded comments + UI). Partial: the AI substrate is present; this specific application is not.

---

## 10. Acceptance Criteria

Each criterion is gradable against the cited source/target.

| ID | Acceptance criterion |
| --- | --- |
| AC-N1 | `tasks` gains `watcherIds: [str]` (default `[]`), accepted by `validate_fields` and validated as a list of existing-user id strings like `assigneeIds`. (`repositories.py:45-67`; `task_service.py:77-88`) |
| AC-N2 | Becoming `coordinatorId`, being added to `assigneeIds`, commenting, or being @mentioned auto-adds the user to the task's `watcherIds` idempotently; an explicit unwatch removes them. (`task_service.py:149/260/387`; `comment_service.py:33-72`) |
| AC-N3 | `POST`/`DELETE /api/v1/tasks/watch` and `POST`/`DELETE`/`GET /api/v1/subscriptions` derive the subscriber from the JWT `sub` (never the body), derive `projectId` from the task, and gate on `can_access(project, user, viewer)`. (`comment_service.py:85`; `notifications.py:12-18`; [`core-collaboration.md`](core-collaboration.md) §3.1) |
| AC-N4 | `notifications` gains `actorId: str`; the producer signature becomes `create(user_id, kind, ref_id, summary, project_id=None, actor_id=None)` and persists `actorId`; `summary` is retained only as a human-readable fallback. (`repositories.py:86-96`; `notification_service.py:13-39`) |
| AC-N5 | New producer `kind`s `assignment`, `mention_on_edit`, `due_soon`, `status_change`, `comment_reply`, `membership_change` are emitted from the named mutation sites, where today only `"mention"` is produced. (`comment_service.py:62-67`; `task_service.py`; `project_service.py`) |
| AC-N6 | `mention_on_edit` notifies **only** mentions newly-added by an edit (the set difference vs the stored `mentions`); previously-mentioned users are never re-notified, preserving the no-re-spam invariant. ([`core-collaboration.md`](core-collaboration.md) §8.3; `comment_service.py:134-156`) |
| AC-N7 | Audience for every kind = explicit targets ∪ task `watcherIds` ∪ project `subscriptions`, minus the actor, minus non-members (`can_access viewer`), de-duplicated — generalising `_notify_mentions`. (`comment_service.py:51-68`) |
| AC-N8 | The inbox groups/collapses notifications by `(kind, refId)` on the read side while storing one row per event (mark-read granularity preserved). (`src/pages/inbox.tsx`; §4.4) |
| AC-N9 | `users` gains a top-level `notificationPrefs` object (`byKind` channel matrix + `quietHours`); a missing kind defaults to all channels on. (`repositories.py:11-19`; `repositories.py:143-147`) |
| AC-N10 | `GET`/`PUT /api/v1/users/notification-prefs` are self-only, write only `notificationPrefs` on the caller's own row, and validate channel flags / `HH:MM` times → `"Bad request"` on malformed input. ([`core-collaboration.md`](core-collaboration.md) Appendix A "own profile") |
| AC-N11 | Both the producer (in-app) and the delivery layer (email/web-push) consult `notificationPrefs`; a muted in-app kind writes no row, and quiet hours suppress only out-of-app channels while the in-app row is still persisted. (§5.4; `notification_service.py:13-39`) |
| AC-N12 | `notification_service.create` triggers a transactional **per-event** email + web-push side effect routed per-kind; there is no delivery-trigger endpoint and no digest/batch/schedule. (`notification_service.py:13-39`; §6) |
| AC-N13 | New collections `pushSubscriptions` (per-browser endpoint/keys) and `deliveries` (per-channel status ledger) are allowlisted in `TABLE_FIELDS`; `POST`/`DELETE /api/v1/push-subscriptions` are self-only with `userId` from the JWT `sub`. (`repositories.py:10-97`) |
| AC-N14 | Slack, Confluence, and scheduled-digest dispatch are explicitly excluded, citing [`v2.1-agent.md`](v2.1-agent.md) N8 / §13; the channel is transactional email + web-push only. (`docs/prd/v2.1-agent.md:82`) |
| AC-N15 | `comments` gains `parentCommentId: str|null` validated to exist, be same-`taskId`, and not be self — one level only (a reply-to-reply re-parents to top-level). (`repositories.py:76-85`; `task_service.py:109-135`; [`core-collaboration.md`](core-collaboration.md) §6.4) |
| AC-N16 | `comments` gains `reactions: {emoji:[userId]}`, `editedAt: str|null`, and `revisions: [{body, editedAt}]`; an edit appends the prior `body` to `revisions` before overwriting and sets `editedAt`, without changing the author-only edit rule. (`repositories.py:76-85`; `comment_service.py:134-156`) |
| AC-N17 | `POST`/`DELETE /api/v1/comments/reactions` add/remove only the **caller's own** reaction (JWT `sub`, idempotent, one user per emoji); `GET /api/v1/comments/revisions` returns the revision list at `viewer`. (`comment_service.py:96-105`) |
| AC-N18 | `@team` mention fan-out expands a team id to member userIds (via the [`accounts-organizations.md`](accounts-organizations.md) directory) then runs the existing per-user eligibility filter (exists, member, not author), skipping ineligible members silently. (`comment_service.py:51-68`; no `teams` collection exists today per `repositories.py:10-97`) |
| AC-N19 | Comment attachments are **not** added by this PRD and are deferred to M7. ([`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) M7) |
| AC-N20 | A new append-only `activity` collection (`entityType, entityId, projectId, actorId, verb, before, after, createdAt`) is written from each service mutation; `GET /api/v1/activity` is `viewer`-gated with no write endpoint. (`repositories.py:10-97`; `notification_service.py:13-39`) |
| AC-N21 | The §8 `activity` timeline is documented as the **user-facing, per-task** history, explicitly distinct from and deferring the M8 **org-wide admin audit log**, and distinct from the AI-only `agent_mutation_journal`. ([`../todo/feature-build-progress.md`](../todo/feature-build-progress.md) M8; `agent_mutation_journal.py`) |
| AC-N22 | The persistent `activity` timeline is documented as distinct from the session-only `useActivityFeed` (a Redux 50-entry FIFO cache dropped on reload). (`src/utils/hooks/useActivityFeed.ts`; [`core-collaboration.md`](core-collaboration.md) §9.4) |
| AC-N23 | AI thread summarization is server-owned, suggest-only, reuses the existing `be.summarize` tool, persists nothing, and does **not** re-spec the already-planned AI inbox triage. ([`v2.1-agent.md`](v2.1-agent.md) §5, §7.8; [`v3-ai-ux.md`](v3-ai-ux.md) §7.2) |
| AC-N24 | Every new mutation inherits the as-built sentinel→HTTP mapping (`"Bad request"`→400, `"Forbidden"`→403, `None`/`"... not found"`→404) and the `TABLE_FIELDS` allowlist. (`validation.py`; `repositories.py:143-147`; [`core-collaboration.md`](core-collaboration.md) §3.5) |

---

## 11. Open Questions & Rollout

### 11.1 Open Questions

| # | Question | Leaning |
| --- | --- | --- |
| Q1 | Should `membership_change` notify the **affected user only**, or also the project's other owners? | Affected user in v1; owner copies behind a pref (`byKind`). |
| Q2 | Is `subscriptions` (project-scope) worth shipping in v1, or is per-task `watcherIds` enough? | Ship `watcherIds` first; `subscriptions` can land a beat later — the audience-resolution code (§4.4) is written to union both from day one. |
| Q3 | Should `groupKey` be persisted on `notifications` for deterministic cross-client grouping, or derived client-side? | Derive client-side in v1 (avoids a migration); persist later if multi-client grouping diverges. |
| Q4 | `due_soon` window + cadence — 24h/once, or escalating (72h, 24h, overdue)? | Single 24h window in v1; escalation is a later pref. |
| Q5 | Do `mention_on_edit` reactions/replies need their own watcher auto-add, or only the original comment's? | Reply author auto-watches the task (§3.2); reactors do not (a reaction is low-intent). |
| Q6 | Email identity/deliverability — which sender domain, and how is bounce handling surfaced? | Owned by the new delivery dependency (§11.2); `deliveries.status` captures failures for retry. |
| Q7 | Should the §8 `activity` write be synchronous in the request path or deferred to a queue? | Synchronous single insert in v1 (cheap, schemaless); revisit if the extra write shows in latency. |
| Q8 | Does `@team` mention expansion cap the fan-out (a 200-member team mention)? | Cap + a "mentioned a large team" collapse; finalised with [`accounts-organizations.md`](accounts-organizations.md). |
| Q9 | Should AI thread summaries ever be pinned/saved as a comment? | No in v1 — suggest-only is the explicit posture (§9.2); saving would make it a mutation. |

### 11.2 Rollout & Dependencies

| Item | Dependency / sequencing | Notes |
| --- | --- | --- |
| **Email + web-push delivery infra (§6)** | **NEW outbound dependency for the repo** | The biggest net-new surface: an SMTP/transactional-email provider + Web Push (VAPID) keys + a delivery queue with retry. Today the repo has **zero** outbound channels (`notification_service.py:13-39`). This is the gating dependency for §6 and the email/web-push half of §5. |
| **`actorId` + new producer kinds (§4)** | Hooks in **`comment_service`**, **`task_service`**, and **membership** (`project_service`) | Producing the new kinds requires adding `notification_service.create` call-sites at every relevant mutation — assignment/move/edit in `task_service.py`, reply/mention-on-edit in `comment_service.py`, and member add/role/remove in `project_service.py`. The `actorId` field is a one-line `TABLE_FIELDS` addition (`repositories.py:86-96`) but every producer must start passing it. |
| **Watchers (§3)** | Precedes §4 audience resolution | `watcherIds` + `subscriptions` must exist before the new kinds have a meaningful audience; ship §3 first (or alongside §4 with watchers defaulting to assignees only). |
| **Activity timeline (§8)** | Requires a write from **every service mutation** | Each `create`/`update`/`delete`/`reorder`/`bulk_update`/membership path gains an append to `activity`. This is a broad, repetitive change touching every service; it is independent of the notification work and can land in parallel. Must be scoped **apart from M8** (the org-wide audit log). |
| **Notification preferences (§5)** | Precedes the delivery routing of §6 | `notificationPrefs` must exist before §6 can route per-channel; the in-app half (mute a kind) can ship without §6. First FE caller of a `users` write. |
| **Comment richness (§7)** | Extends the **⬜ base comments UI** ([`core-collaboration.md`](core-collaboration.md) §12) | Threading/reactions/edit-history fields are additive to `comments`; the **UI depends on the base comments UI being built first** (it does not exist today). `@team` mentions further depend on [`accounts-organizations.md`](accounts-organizations.md) teams. Attachments **deferred to M7**. |
| **AI thread summarization (§9)** | Depends on §7 threading + the existing agent framework | Reuses `be.summarize` ([`v2.1-agent.md`](v2.1-agent.md) §5); no new infra. Gated on §7's threaded comment UI existing to host the affordance. Does **not** re-spec AI triage. |
| **Deferred / excluded** | M7 (attachments, real-time/SSE), M8 (org-wide audit), [`v2.1-agent.md`](v2.1-agent.md) N8/§13 (Slack/Confluence/digest) | Cross-referenced throughout; **not** built here. |
| **Persistence/perf** | Extension point, not a gate | New list endpoints (`GET /subscriptions`, `GET /activity`) are unpaginated scans like their siblings ([`core-collaboration.md`](core-collaboration.md) §3); indexes on `tasks.watcherIds`, `activity.(projectId, entityId)`, and `deliveries.notificationId` are noted as future optimisations. |

---

## Appendix A — Endpoint reference

Net-new (and extended) endpoints introduced by this PRD. All require a valid REST JWT ([`core-collaboration.md`](core-collaboration.md) §3.1); the **Required role** column is the *additional* per-resource altitude. Collection-root URLs, id-in-body for `PUT`, id-in-query for `DELETE`/`GET`, sentinel→HTTP per `validation.py`.

| Method | Path | Required role | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/tasks/watch` | `viewer` (task's project) | Add caller to a task's `watcherIds` (idempotent; `projectId` derived from task) |
| `DELETE` | `/api/v1/tasks/watch` | `viewer` | Remove caller from `watcherIds` (`?taskId=`) |
| `POST` | `/api/v1/subscriptions` | `viewer` (on `projectId`) | Upsert caller's project-scope subscription |
| `DELETE` | `/api/v1/subscriptions` | `viewer` | Delete caller's subscription (`?projectId=&scope=`) |
| `GET` | `/api/v1/subscriptions` | self only | Caller's own subscriptions (no params) |
| `GET` | `/api/v1/users/notification-prefs` | self only | Read caller's `notificationPrefs` (defaults materialised) |
| `PUT` | `/api/v1/users/notification-prefs` | self only | Patch caller's per-kind/per-channel prefs + quiet hours |
| `POST` | `/api/v1/push-subscriptions` | self only | Register caller's web-push subscription (endpoint + keys) |
| `DELETE` | `/api/v1/push-subscriptions` | self only | Remove a web-push subscription (`?endpoint=`) |
| `POST` | `/api/v1/comments` (extended) | `viewer` (task's project) | Create comment; now accepts optional `parentCommentId` (reply → `comment_reply`) |
| `POST` | `/api/v1/comments/reactions` | `viewer` | Add caller's emoji reaction (`{_id, emoji}`; idempotent) |
| `DELETE` | `/api/v1/comments/reactions` | `viewer` | Remove caller's reaction (`?commentId=&emoji=`) |
| `GET` | `/api/v1/comments/revisions` | `viewer` (task's project) | Comment edit history + current body (`?commentId=`) |
| `GET` | `/api/v1/activity` | `viewer` (on `projectId`) | Per-entity (`?entityType=&entityId=`) or project (`?projectId=`) activity, newest-first |

Internal producers (no endpoint, inherited pattern): `notification_service.create(...)` now takes `actor_id` and is invoked from `comment_service`/`task_service`/membership for the new kinds; the email/web-push delivery side effect and the `activity` append are likewise internal-only (no client-facing trigger), exactly as the in-app notification write is internal today (`notification_service.py:13-39`). The AI thread summarization rides the existing agent stream ([`v2.1-agent.md`](v2.1-agent.md) §5), adding no new top-level route.

---

## Appendix B — Data model

New collections and the changed fields on existing collections, all under the per-table `TABLE_FIELDS` allowlist (`repositories.py:10-97`) with `password` stripped on serialize and `createdAt`/`updatedAt` repository-managed. **Bold** marks fields net-new to this PRD.

| Collection | Fields |
| --- | --- |
| `tasks` (changed) | `_id`, `taskName`, `coordinatorId`, `epic`, `columnId`, `note`, `type`, `projectId`, `storyPoints`, `index`, `startDate`, `dueDate`, `labelIds`, `assigneeIds`, `parentTaskId`, **`watcherIds` (`[str]`, default `[]`)**, `createdAt`, `updatedAt` |
| `comments` (changed) | `_id`, `taskId`, `projectId`, `authorId`, `body`, `mentions`, **`parentCommentId` (`str|null`, default `null`)**, **`reactions` (`{emoji:[userId]}`, default `{}`)**, **`editedAt` (`str|null`, default `null`)**, **`revisions` (`[{body, editedAt}]`, default `[]`)**, `createdAt`, `updatedAt` |
| `notifications` (changed) | `_id`, `userId`, `kind` (now `mention`/`assignment`/`mention_on_edit`/`due_soon`/`status_change`/`comment_reply`/`membership_change`), `refId`, `projectId`, **`actorId` (`str`, optional)**, `summary` (now a fallback; actor rendered from `actorId`), `isRead`, `createdAt`, `updatedAt` |
| `users` (changed) | `_id`, `username`, `email`, `password` (never serialized), `likedProjects`, **`notificationPrefs` (`{byKind:{kind→{inApp,email,webPush}}, quietHours:{enabled,start,end,tz}}`)**, `createdAt`, `updatedAt` |
| **`subscriptions`** (new) | `_id`, `userId`, `projectId`, `scope` (`"project"`; reserved `"label"`/`"epic"`), `createdAt`, `updatedAt` |
| **`pushSubscriptions`** (new) | `_id`, `userId`, `endpoint`, `keys` (`{p256dh, auth}`), `createdAt`, `updatedAt` |
| **`deliveries`** (new) | `_id`, `notificationId`, `userId`, `channel` (`"email"`/`"webPush"`), `status` (`"queued"`/`"sent"`/`"failed"`), `error` (optional), `createdAt`, `updatedAt` |
| **`activity`** (new) | `_id`, `entityType` (`task`/`comment`/`column`/`project`/`member`), `entityId`, `projectId`, `actorId`, `verb`, `before` (optional), `after` (optional), `createdAt` — append-only; **user-facing per-task history**, distinct from the M8 admin audit log and the AI-only `agent_mutation_journal` |

Out of scope here (named for boundary clarity, **not** added by this PRD): comment/task **attachments** (`attachmentIds[]`, M7/GridFS); the **org-wide admin audit** collection (M8); any real-time/SSE transport (M7); Slack/Confluence/digest dispatch ([`v2.1-agent.md`](v2.1-agent.md) N8/§13). The AI-only `agent_mutation_journal` (`user_id, project_id, proposal_id, undo_diff, createdAt, undoneAt`) is unchanged and remains AI-scoped (`agent_mutation_journal.py`).
