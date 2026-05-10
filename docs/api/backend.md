# HTTP API Reference — pulse (backend)

**Target audience:** backend and frontend engineers integrating against this server.
This document is sufficient to implement a client without reading source code.

---

## Table of Contents

1. [Base URL and Transport](#1-base-url-and-transport)
2. [Authentication](#2-authentication)
3. [Common Error Envelope](#3-common-error-envelope)
4. [Idempotency-Key Header](#4-idempotency-key-header)
5. [Rate Limiting](#5-rate-limiting)
6. [Per-Project Budget](#6-per-project-budget)
7. [SSE Event Format (Agents Stream)](#7-sse-event-format-agents-stream)
8. [Auth](#8-auth)
9. [Users](#9-users)
10. [Projects](#10-projects)
11. [Boards (Columns)](#11-boards-columns)
12. [Tasks](#12-tasks)
13. [Health](#13-health)
14. [AI v1 (`/api/v1/ai/*`)](#14-ai-v1-apiv1ai)
15. [Agents v2.1 (`/api/v1/agents/*`)](#15-agents-v21-apiv1agents)

---

## 1. Base URL and Transport

```
https://<host>
```

All endpoints are served over HTTPS in production. No version prefix is required for Auth, Users, Projects, Boards, and Tasks — they all live under `/api/v1/`. The legacy alias `/api/ai/*` (without `v1`) mirrors the AI v1 router exactly and is kept for backward compatibility with the shipped React client; new integrations should use `/api/v1/ai/*`.

CORS is controlled by `CORS_ORIGINS` (comma-separated) and `CORS_ORIGIN_REGEX`. Credentialed requests are allowed. Allowed headers include `Authorization`, `Content-Type`, `X-Request-Id`, `Idempotency-Key`, and `Accept`. Exposed response headers include `X-Request-Id`, `Deprecation`, `Sunset`, `Retry-After`, and `Idempotent-Replay`.

---

## 2. Authentication

### Obtaining a Token

Call `POST /api/v1/auth/login` (documented below) with `email` and `password`. The response body contains a `jwt` field.

### Sending the Token

All protected endpoints require:

```
Authorization: Bearer <jwt>
```

The token is a signed HS256 JWT. Required claims: `sub` (user ID string), `iat`, `exp`.

### Token TTL

Configured via `JWT_EXPIRES_SECONDS` (default: `86400` — 24 hours). After expiry the server returns `401 {"error": "invalid JWT"}`.

### Token Validation Errors

| Condition | Status | Body |
|---|---|---|
| Missing or malformed `Authorization` header | 401 | `{"error": "empty JWT"}` |
| Expired or invalid signature | 401 | `{"error": "invalid JWT"}` |

---

## 3. Common Error Envelope

All error responses are JSON objects with a single `"error"` key.

**Simple errors** (most routes):

```json
{"error": "Project not found"}
```

**Validation errors** (register, update user, create task, etc.):

```json
{
  "error": [
    {"msg": "Username cannot be empty", "param": "username", "location": "body"},
    {"msg": "Email has already been registered", "param": "email", "value": "user@example.com", "location": "body"}
  ]
}
```

Values for fields in `SENSITIVE_FIELDS` (`password`, `currentPassword`, `token`, `jwt`) are always redacted to `"[REDACTED]"` in error bodies.

**Unhandled server errors** always return:

```json
{"error": "internal_server_error"}
```

FastAPI 422 (request-body validation) errors are normalised through `unwrap_error_detail` in `app/validation.py` so they also arrive in the `{"error": ...}` envelope.

---

## 4. Idempotency-Key Header

The following routes honour the `Idempotency-Key` header (Stripe-style deduplication):

- `POST /api/v1/ai/task-draft`
- `POST /api/v1/ai/task-breakdown`
- `POST /api/v1/ai/estimate`
- `POST /api/v1/ai/readiness`
- `POST /api/v1/ai/board-brief`
- `POST /api/v1/ai/search`
- `POST /api/v1/ai/chat`
- `POST /api/v1/agents/{name}/invoke`

(The `/api/ai/*` aliases also honour the header because they share the same router.)

### Semantics

- Send `Idempotency-Key: <key>` with any idempotent-safe mutation. The key must be 1–255 characters composed of `[A-Za-z0-9_\-:./]` only.
- On the **first** call with a key the request is executed normally, the result is cached, and the response is returned.
- On a **replay** (same key, same request body) the cached response is returned immediately with the additional header `Idempotent-Replay: true`.
- If the **same key is reused with a different body**, the server returns `422` with `{"error": "idempotency_key_reused", "message": "..."}`.
- If a **sibling request with the same key is still in flight**, the server returns `409` with `{"error": "idempotency_key_in_progress", "message": "..."}`.

Cache TTL is controlled by `IDEMPOTENCY_TTL_SECONDS` (default: `86400`). The idempotency backend (`memory` or `redis`) is selected by `IDEMPOTENCY_BACKEND`; see [`../operations/deployment.md`](../operations/deployment.md) for multi-worker caveats.

---

## 5. Rate Limiting

Rate limits are enforced per `(agent_label, user_id)` pair using a rolling window. Limits are declared in each agent's `AgentMetadata.rate_limit` as `(per_minute, per_hour)`. The default for all v1 shim routes is `(60, 600)`.

When the limit is exceeded the server returns:

```
HTTP 429 Too Many Requests
Retry-After: <seconds>
```

```json
{"error": "rate limit exceeded"}
```

`Retry-After` is the number of seconds until the next slot opens in the breached window (minimum 1). The rate-limit backend (`memory` or `redis`) is selected by `RATE_LIMIT_BACKEND`.

---

## 6. Per-Project Budget

A monthly token cap (default `1_000_000`, configurable via `AGENT_BUDGET_MONTHLY_TOKEN_CAP`) is enforced per project. The budget is debited 1 token at gate time and true-up occurs after the LLM call based on actual provider usage.

When the budget is exhausted:

```
HTTP 402 Payment Required
X-Reason: budget
```

```json
{"error": "project budget exhausted"}
```

The budget backend (`memory` or `redis`) is selected by `BUDGET_BACKEND`. The budget resets at the start of each calendar month (UTC).

---

## 7. SSE Event Format (Agents Stream)

`POST /api/v1/agents/{name}/stream` returns `Content-Type: text/event-stream`. Each frame is:

```
data: <JSON>\n\n
```

The final frame is always:

```
data: [DONE]\n\n
```

Every JSON payload (except `[DONE]`) conforms to the `StreamPart` discriminated union:

```
{
  "type": "updates" | "messages" | "custom" | "interrupt" | "error",
  "ns": string[],
  "data": <type-specific object>
}
```

### Event Types

#### `updates`

Node-level state diff from the LangGraph graph. `data` is a JSON object keyed by node name.

```json
{"type": "updates", "ns": [], "data": {"generate": {"messages": [...]}}}
```

#### `messages`

Streaming LLM token. `data` is a two-element array `[LLMTokenChunk, MessageMetadata]`.

```json
{
  "type": "messages",
  "ns": [],
  "data": [
    {"content": "Here is", "type": "ai"},
    {"run_id": "abc123"}
  ]
}
```

#### `custom`

Application-level event emitted by the agent via `langgraph.types.interrupt` or a custom node. When `data.kind == "usage"` it carries token accounting:

```json
{
  "type": "custom",
  "ns": [],
  "data": {"kind": "usage", "tokensIn": 312, "tokensOut": 87}
}
```

Other `custom` events have agent-specific `data` shapes.

#### `interrupt`

The agent paused at a `langgraph.types.interrupt` call and needs data from the FE before it can continue. `data` contains the FE tool name and its arguments:

```json
{
  "type": "interrupt",
  "ns": [],
  "data": {"tool": "fe.boardSnapshot", "args": {"project_id": "proj_abc"}}
}
```

The FE executes the named tool locally and resumes the agent by calling `POST /api/v1/agents/{name}/stream` (or `/invoke`) again with `command.resume` carrying the tool result. See [Interrupt / Resume](#interrupt--resume) below.

#### `error`

A mid-stream error. After this frame, `[DONE]` follows.

```json
{
  "type": "error",
  "ns": [],
  "data": {"message": "Agent run exceeded 120s timeout", "recoverable": false}
}
```

`recoverable: false` means the run has terminated; the client should not retry without user action.

### Interrupt / Resume

When an `interrupt` event is received:

1. Collect the FE tool result (the FE drives this against its own client-side state).
2. POST to the **same endpoint** (`/invoke` or `/stream`) with the same `thread_id` and the `command.resume` field set to the tool result value.

Resume body example:

```json
{
  "thread_id": "thread_xyz",
  "command": {
    "resume": {
      "project_id": "proj_abc",
      "columns": [...],
      "tasks": [...],
      "members": [...]
    }
  }
}
```

`inputs` and `command.resume` are mutually exclusive — sending both returns `400`.

---

## 8. Auth

Base path: `/api/v1/auth`

### POST /api/v1/auth/register

Create a new user account.

**Auth:** None required.

**Request body:**

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "secret123"
}
```

| Field | Type | Rules |
|---|---|---|
| `username` | string | Required, minimum 3 characters |
| `email` | string | Required, must be a valid email address, must not already be registered |
| `password` | string | Required, minimum 5 characters |

**Response — 201 Created:**

```json
"User created"
```

**Status codes:**

| Code | Condition |
|---|---|
| 201 | User created successfully |
| 400 | Validation errors (see error envelope) |

**Example curl:**

```http
POST /api/v1/auth/register
Content-Type: application/json

{"username": "alice", "email": "alice@example.com", "password": "secret123"}
```

---

### POST /api/v1/auth/login

Authenticate and receive a JWT.

**Auth:** None required.

**Request body:**

```json
{
  "email": "alice@example.com",
  "password": "secret123"
}
```

| Field | Type | Rules |
|---|---|---|
| `email` | string | Required, valid email format |
| `password` | string | Required |

**Response — 200 OK:**

```json
{
  "_id": "64a1f2e3b4c5d6e7f8a9b0c1",
  "username": "alice",
  "email": "alice@example.com",
  "likedProjects": ["64a1f2e3b4c5d6e7f8a9b0c2"],
  "jwt": "eyJhbGciOiJIUzI1NiJ9..."
}
```

Use the `jwt` value as the Bearer token for all subsequent requests.

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Login succeeded |
| 400 | Validation errors (empty or malformed fields) |
| 401 | Invalid credentials (email not found or wrong password) |
| 503 | JWT secret not configured on the server |

**Note:** Unknown email and wrong password produce the same `401` response to prevent user enumeration.

---

## 9. Users

Base path: `/api/v1/users`

All users endpoints require a valid JWT (`Authorization: Bearer <token>`).

---

### GET /api/v1/users

Retrieve the authenticated user's own profile.

**Auth:** Required.

**Request:** No parameters.

**Response — 200 OK:**

```json
{
  "_id": "64a1f2e3b4c5d6e7f8a9b0c1",
  "username": "alice",
  "email": "alice@example.com",
  "likedProjects": ["64a1f2e3b4c5d6e7f8a9b0c2"]
}
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | User found |
| 401 | Missing or invalid JWT |
| 404 | User not found (JWT sub does not match any user) |

---

### PUT /api/v1/users/

Update the authenticated user's profile.

**Auth:** Required.

**Request body** (all fields optional; only listed fields are writable):

```json
{
  "username": "alice_updated",
  "email": "alice2@example.com",
  "password": "newpass"
}
```

| Field | Type | Rules |
|---|---|---|
| `username` | string | Optional; must not already be taken |
| `email` | string | Optional; must be valid email, must not already be taken |
| `password` | string | Optional; minimum 5 characters |

Other fields in the request body are rejected with a validation error listing the unknown fields.

**Response — 200 OK:** Same shape as `GET /api/v1/users`.

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Updated successfully |
| 400 | Validation errors (unknown fields, duplicate email/username, short password) |
| 401 | Missing or invalid JWT |
| 404 | User not found |

---

### GET /api/v1/users/members

List all registered users with public fields only (directory).

**Auth:** Required.

**Request:** No parameters.

**Response — 200 OK:**

```json
[
  {"_id": "64a1f2e3b4c5d6e7f8a9b0c1", "username": "alice", "email": "alice@example.com"},
  {"_id": "64b2a3d4c5e6f7a8b9c0d1e2", "username": "bob",   "email": "bob@example.com"}
]
```

Only `_id`, `username`, and `email` are returned; all other user fields are omitted.

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Members found |
| 401 | Missing or invalid JWT |
| 404 | No members in the database |

---

### PUT /api/v1/users/likes

Toggle a project in the authenticated user's liked-projects list (idempotent toggle: calling twice removes the like).

**Auth:** Required.

**Request body:**

```json
{"projectId": "64a1f2e3b4c5d6e7f8a9b0c2"}
```

| Field | Type | Rules |
|---|---|---|
| `projectId` | string | Required |

**Response — 200 OK:** Full user profile (same shape as `GET /api/v1/users`).

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Like status toggled |
| 400 | `projectId` missing from body |
| 401 | Missing or invalid JWT |
| 404 | User or project not found |

---

## 10. Projects

Base path: `/api/v1/projects`

All project endpoints require a valid JWT. Project access is restricted to the project manager (the user who created it, or to whom ownership was transferred).

---

### POST /api/v1/projects/

Create a new project. The authenticated user becomes the manager.

**Auth:** Required.

**Request body:**

```json
{
  "projectName": "Acme Backlog",
  "organization": "Acme Corp"
}
```

| Field | Type | Rules |
|---|---|---|
| `projectName` | string | Required, non-empty |
| `organization` | string | Required, non-empty |

**Response — 201 Created:**

```json
"Project created"
```

**Status codes:**

| Code | Condition |
|---|---|
| 201 | Project created |
| 400 | Validation errors (missing `projectName` or `organization`) |
| 401 | Missing or invalid JWT |

---

### GET /api/v1/projects/

Retrieve one or more projects visible to the authenticated manager.

**Auth:** Required.

**Query parameters:**

| Parameter | Type | Notes |
|---|---|---|
| `projectId` | string | Optional. Fetch a single project by ID. Returns 403 if the caller is not the manager. |
| `projectName` | string | Optional. Filter by name (exact match). |
| `managerId` | string | Optional. Must equal the authenticated user's ID; otherwise 403. |

When no parameters are provided, all projects belonging to the authenticated user are returned.

**Response — 200 OK** (list query):

```json
[
  {
    "_id": "64a1f2e3b4c5d6e7f8a9b0c2",
    "projectName": "Acme Backlog",
    "organization": "Acme Corp",
    "managerId": "64a1f2e3b4c5d6e7f8a9b0c1"
  }
]
```

**Response — 200 OK** (single project via `projectId`):

```json
{
  "_id": "64a1f2e3b4c5d6e7f8a9b0c2",
  "projectName": "Acme Backlog",
  "organization": "Acme Corp",
  "managerId": "64a1f2e3b4c5d6e7f8a9b0c1"
}
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Project(s) found |
| 401 | Missing or invalid JWT |
| 403 | `projectId` belongs to another manager, or `managerId` does not match caller |
| 404 | No matching project(s) found |

---

### PUT /api/v1/projects/

Update a project. Only the manager may update.

**Auth:** Required (must be manager of the project).

**Request body:**

```json
{
  "_id": "64a1f2e3b4c5d6e7f8a9b0c2",
  "projectName": "Acme Backlog v2",
  "organization": "Acme Corp",
  "managerId": "64b2a3d4c5e6f7a8b9c0d1e2"
}
```

| Field | Type | Rules |
|---|---|---|
| `_id` | string | Required — identifies the project to update |
| `projectName` | string | Optional |
| `organization` | string | Optional |
| `managerId` | string | Optional — transfers ownership; the target user must exist |

**Response — 200 OK:**

```json
"Project updated"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Updated successfully |
| 400 | `_id` missing from body |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Project not found, or `managerId` references a non-existent user |

---

### DELETE /api/v1/projects/

Delete a project and all its columns and tasks (cascading deletion).

**Auth:** Required (must be manager of the project).

**Query parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `projectId` | string | Required |

**Response — 200 OK:**

```json
"Project deleted"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Project deleted |
| 400 | `projectId` not provided or other bad request |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Project not found |

---

## 11. Boards (Columns)

Base path: `/api/v1/boards`

Board endpoints manage columns on a project board. All require a valid JWT and the caller must be the project manager.

When a project has no columns, `GET /api/v1/boards/` seeds three default columns ("To Do", "In Progress", "Done") before returning.

---

### GET /api/v1/boards/

Retrieve all columns for a project, sorted by `index`.

**Auth:** Required (must be project manager).

**Query parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `projectId` | string | Required |

**Response — 200 OK:**

```json
[
  {"_id": "col_a", "columnName": "To Do",      "projectId": "proj_abc", "index": 0},
  {"_id": "col_b", "columnName": "In Progress", "projectId": "proj_abc", "index": 1},
  {"_id": "col_c", "columnName": "Done",        "projectId": "proj_abc", "index": 2}
]
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Columns returned (auto-seeded if none existed) |
| 400 | `projectId` not provided |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Project not found |

---

### POST /api/v1/boards/

Add a new column to a project board.

**Auth:** Required (must be project manager).

**Request body:**

```json
{
  "columnName": "Review",
  "projectId": "proj_abc"
}
```

| Field | Type | Rules |
|---|---|---|
| `columnName` | string | Required, non-empty |
| `projectId` | string | Required, non-empty |

**Response — 201 Created:**

```json
"Column created"
```

**Status codes:**

| Code | Condition |
|---|---|
| 201 | Column created |
| 400 | Validation errors (missing `columnName` or `projectId`) |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Project not found |

---

### PUT /api/v1/boards/orders

Reorder columns on a board (move `fromId` relative to `referenceId`).

**Auth:** Required (must be project manager).

**Request body:**

```json
{
  "type": "before",
  "fromId": "col_b",
  "referenceId": "col_a"
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"before"` or `"after"` |
| `fromId` | string | ID of the column being moved |
| `referenceId` | string | ID of the column used as the anchor |

**Response — 200 OK:**

```json
"Column reordered"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Reordered successfully |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | One or both column IDs not found |

---

### DELETE /api/v1/boards/

Delete a column and all its tasks.

**Auth:** Required (must be project manager).

**Query parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `columnId` | string | Required |

**Response — 200 OK:**

```json
"Column deleted"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Column deleted |
| 400 | `columnId` not provided |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Column not found |

---

## 12. Tasks

Base path: `/api/v1/tasks`

All task endpoints require a valid JWT and the caller must be the project manager.

When a project has no tasks, `GET /api/v1/tasks/` seeds a single default task in the "To Do" column (or the first available column if "To Do" does not exist).

---

### GET /api/v1/tasks/

Retrieve all tasks for a project, sorted by `index` within each column.

**Auth:** Required (must be project manager).

**Query parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `projectId` | string | Required |

**Response — 200 OK:**

```json
[
  {
    "_id": "task_001",
    "taskName": "Implement login page",
    "type": "feature",
    "epic": "Auth",
    "storyPoints": 3,
    "note": "Must support SSO.",
    "columnId": "col_a",
    "projectId": "proj_abc",
    "coordinatorId": "64a1f2e3b4c5d6e7f8a9b0c1",
    "index": 0
  }
]
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Tasks returned (auto-seeded if none existed) |
| 400 | `projectId` not provided |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Project not found or no columns exist |

---

### POST /api/v1/tasks/

Create a new task.

**Auth:** Required (must be project manager).

**Request body:**

```json
{
  "projectId": "proj_abc",
  "columnId": "col_a",
  "taskName": "Implement login page",
  "type": "feature",
  "epic": "Auth",
  "storyPoints": 3,
  "note": "Must support SSO.",
  "coordinatorId": "64a1f2e3b4c5d6e7f8a9b0c1"
}
```

| Field | Type | Rules |
|---|---|---|
| `projectId` | string | Required, non-empty |
| `columnId` | string | Required, non-empty; must belong to `projectId` |
| `taskName` | string | Required, non-empty |
| `type` | string | Required, non-empty |
| `epic` | string | Required, non-empty |
| `storyPoints` | number | Required |
| `note` | string | Required, non-empty |
| `coordinatorId` | string | Optional; if provided, must be a valid user ID |

**Response — 201 Created:**

```json
"Task created"
```

**Status codes:**

| Code | Condition |
|---|---|
| 201 | Task created |
| 400 | Missing required fields or `columnId` does not belong to `projectId` |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |

---

### PUT /api/v1/tasks/

Update a task.

**Auth:** Required (must be project manager).

**Request body:**

```json
{
  "_id": "task_001",
  "taskName": "Implement login page (revised)",
  "storyPoints": 5,
  "columnId": "col_b"
}
```

| Field | Type | Rules |
|---|---|---|
| `_id` | string | Required — identifies the task |
| `taskName` | string | Optional |
| `type` | string | Optional |
| `epic` | string | Optional |
| `storyPoints` | number | Optional |
| `note` | string | Optional |
| `columnId` | string | Optional; if changed, must belong to the same project |
| `projectId` | string | Optional |
| `coordinatorId` | string | Optional; must be a valid user ID if provided |

**Response — 200 OK:**

```json
"Task updated"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Updated successfully |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |
| 404 | Task not found, or referenced column/project/coordinator does not exist |

---

### DELETE /api/v1/tasks/

Delete a task.

**Auth:** Required (must be project manager).

**Query parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `taskId` | string | Required |

**Response — 200 OK:**

```json
"Task deleted"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Task deleted |
| 400 | `taskId` not provided or task not found |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |

---

### PUT /api/v1/tasks/orders

Reorder tasks within or across columns.

**Auth:** Required (must be project manager).

**Request body:**

```json
{
  "type": "before",
  "fromId": "task_002",
  "referenceId": "task_001",
  "fromColumnId": "col_a",
  "referenceColumnId": "col_a"
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"before"` or `"after"` |
| `fromId` | string | ID of the task being moved |
| `referenceId` | string | ID of the anchor task (can be `null` to move to end of column) |
| `fromColumnId` | string | Column the task is moving from |
| `referenceColumnId` | string | Column the task is moving into (may differ for cross-column moves) |

**Response — 200 OK:**

```json
"Task reordered"
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Reordered successfully |
| 400 | Missing IDs, columns not in the same project, or stale reference IDs |
| 401 | Missing or invalid JWT |
| 403 | Caller is not the project manager |

---

## 13. Health

### GET /api/v1/health

Check the operational status of the server. Also available at the legacy path `GET /health`.

**Auth:** None required.

**Request:** No parameters.

**Response — 200 OK:**

```json
{
  "status": "ok",
  "ok": true,
  "database": "ok",
  "agents_loaded": 6,
  "agentsLoaded": 6,
  "latency_ms": 1.23,
  "latencyMs": 1.23,
  "checkpointer": "memory",
  "store": "memory",
  "agent_persistence": "memory",
  "agentPersistence": "memory",
  "agent_persistence_ok": true,
  "agentPersistenceOk": true
}
```

When the database ping fails, `status` becomes `"degraded"` and `ok` becomes `false`. The endpoint always returns `200` regardless — callers must inspect `ok` to determine health.

Both snake_case and camelCase aliases are emitted for all fields to support the existing test suite and the React client (`useAgentHealth`) without any client-side mapping.

`latency_ms` / `latencyMs` reflects the round-trip time of the database ping in milliseconds.

---

## 14. AI v1 (`/api/v1/ai/*` and legacy `/api/ai/*`)

Base path: `/api/v1/ai`

Legacy alias also mounted at `/api/ai` (no `v1`) for backward compatibility with the shipped React client.

All AI v1 endpoints:

- Require a valid JWT.
- Enforce the project-manager gate (caller must be manager of the project identified in the payload's `context.project._id`).
- Enforce the per-agent rate limit (default 60/min, 600/hr) and per-project monthly token budget.
- Apply server-side redaction to free-text `prompt` and `messages[].content` (role `user`) before the content is passed to any LLM (see `app/tools/redaction`).
- Honour the `Idempotency-Key` header.

### Envelope Unwrapping (`_unwrap_envelope`)

The React client (`useAi.ts`) wraps every payload in a named envelope:

```json
{"draft": {"prompt": "...", "context": {...}}}
```

The server unwraps this automatically via `_unwrap_envelope` in `app/routers/ai.py` before processing. **Both the wrapped envelope form and the flat form are accepted**:

- Wrapped: `{"draft": {"prompt": "Fix the login bug", "context": {...}}}`
- Flat: `{"prompt": "Fix the login bug", "context": {...}}`

The envelope key name per route is noted in each endpoint below.

### Project ID Resolution

Project ID is extracted from the payload using the following priority order:

1. `context.project._id`
2. `projectContext.project._id`

If no project ID is found in the payload, project-manager and budget gates are skipped.

---

### POST /api/v1/ai/task-draft

Generate a task draft from a prompt.

**Auth:** Required. Project manager gate applied.

**Idempotency-Key:** Honoured.

**Envelope key for unwrapping:** `"draft"`

**Request body (flat form):**

```json
{
  "prompt": "Fix the login page crash on Safari",
  "columnId": "col_a",
  "coordinatorId": "64a1f2e3b4c5d6e7f8a9b0c1",
  "context": {
    "project": {"_id": "proj_abc"},
    "tasks": [
      {"_id": "t1", "taskName": "Login flow", "note": "SSO support"}
    ],
    "columns": [{"_id": "col_a", "name": "To Do"}],
    "members": [{"_id": "64a1f2e3b4c5d6e7f8a9b0c1"}]
  }
}
```

**Request body (wrapped envelope form):**

```json
{
  "draft": {
    "prompt": "Fix the login page crash on Safari",
    "context": {"project": {"_id": "proj_abc"}}
  }
}
```

**Response — 200 OK:**

```json
{
  "taskName": "Fix the login page crash on Safari",
  "type": "bug",
  "epic": "Bug Fix",
  "storyPoints": 1,
  "note": "Fix the login page crash on Safari",
  "columnId": "col_a",
  "coordinatorId": "64a1f2e3b4c5d6e7f8a9b0c1",
  "confidence": 0.55,
  "rationale": "Heuristic draft from prompt keywords."
}
```

When a real LLM provider is configured (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), `taskName`, `note`, and `rationale` are rewritten by the `task-drafting-agent`'s `polish_draft` helper.

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Draft returned |
| 401 | Missing or invalid JWT |
| 402 | Project budget exhausted |
| 403 | AI disabled for project or caller is not manager |
| 409 | Idempotency key in progress |
| 422 | Idempotency key reused with different body |
| 429 | Rate limit exceeded |
| 502 | LLM provider error |

---

### POST /api/v1/ai/task-breakdown

Break a task into multiple sub-task drafts.

**Auth:** Required. Project manager gate applied.

**Idempotency-Key:** Honoured.

**Envelope key for unwrapping:** `"draft"`

**Request body (flat form):**

```json
{
  "prompt": "Build a user authentication system",
  "count": 3,
  "context": {
    "project": {"_id": "proj_abc"}
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `prompt` | string | Description of the parent task |
| `count` | integer | Number of sub-tasks to generate (1–5, default 3) |
| `context` | object | Same shape as `/task-draft` |

**Response — 200 OK:**

```json
{
  "items": [
    {
      "taskName": "Build a user authentication system (part 1)",
      "type": "feature",
      "epic": "Auth",
      "storyPoints": 1,
      "note": "Build a user authentication system",
      "columnId": "",
      "coordinatorId": "",
      "confidence": 0.55,
      "rationale": "Slice 1 of the parent task."
    },
    {
      "taskName": "Build a user authentication system (part 2)",
      "type": "feature",
      "epic": "Auth",
      "storyPoints": 1,
      "note": "Build a user authentication system",
      "columnId": "",
      "coordinatorId": "",
      "confidence": 0.55,
      "rationale": "Slice 2 of the parent task."
    }
  ]
}
```

When a real LLM is configured, each item's `taskName` and `note` are polished.

**Status codes:** Same as `/task-draft`.

---

### POST /api/v1/ai/estimate

Estimate story points for a task.

**Auth:** Required. Project manager gate applied.

**Idempotency-Key:** Honoured.

**Envelope key for unwrapping:** `"estimate"`

**Request body (flat form):**

```json
{
  "taskName": "Implement SSO login",
  "note": "Must support Google and GitHub OAuth.",
  "context": {
    "project": {"_id": "proj_abc"},
    "tasks": [
      {"_id": "t1", "taskName": "Login flow", "note": "Basic auth"}
    ]
  }
}
```

**Response — 200 OK:**

```json
{
  "storyPoints": 3,
  "confidence": 0.7,
  "rationale": "Derived from prompt length + nearest-neighbour tasks.",
  "similar": [
    {"_id": "t1", "reason": "shares 45% keywords"}
  ]
}
```

Story points are snapped to Fibonacci values: 1, 2, 3, 5, 8, or 13. When a real LLM is configured, `rationale` is rewritten by `polish_rationale`.

**Status codes:** Same as `/task-draft`.

---

### POST /api/v1/ai/readiness

Check whether a task draft is ready to be created (identifies missing fields).

**Auth:** Required. Project manager gate applied.

**Idempotency-Key:** Honoured.

**Envelope key for unwrapping:** `"readiness"`

**Request body (flat form):**

```json
{
  "taskName": "Fix login bug",
  "note": "",
  "epic": "",
  "type": "bug",
  "coordinatorId": "",
  "context": {
    "project": {"_id": "proj_abc"}
  }
}
```

**Response — 200 OK (issues found):**

```json
{
  "issues": [
    {
      "field": "note",
      "severity": "warn",
      "message": "Acceptance criteria are missing."
    },
    {
      "field": "epic",
      "severity": "warn",
      "message": "Epic helps grouping; pick one."
    }
  ]
}
```

**Response — 200 OK (no issues):**

```json
{"issues": []}
```

`severity` is `"error"` for `taskName` (blocking) and `"warn"` for all other fields. When a real LLM is configured and issues exist, the issue list is rewritten by `polish_readiness`.

**Status codes:** Same as `/task-draft`.

---

### POST /api/v1/ai/board-brief

Generate a summary of the current board state.

**Auth:** Required. Project manager gate applied.

**Idempotency-Key:** Honoured.

**Envelope key for unwrapping:** `"brief"`

**Request body (flat form):**

```json
{
  "context": {
    "project": {"_id": "proj_abc"},
    "columns": [
      {"_id": "col_a", "name": "To Do"},
      {"_id": "col_b", "name": "Done"}
    ],
    "tasks": [
      {"_id": "t1", "taskName": "Fix bug", "storyPoints": 3, "columnId": "col_a", "coordinatorId": "user1"}
    ],
    "members": [
      {"_id": "user1", "username": "alice"}
    ]
  }
}
```

**Response — 200 OK:**

```json
{
  "headline": "1 tasks across 2 columns; 0 unowned, 1 large unstarted.",
  "counts": [
    {"columnId": "col_a", "columnName": "To Do", "count": 1},
    {"columnId": "col_b", "columnName": "Done",  "count": 0}
  ],
  "largestUnstarted": [
    {"taskId": "t1", "taskName": "Fix bug", "storyPoints": 3}
  ],
  "unowned": [],
  "workload": [
    {"memberId": "user1", "username": "alice", "openTasks": 1, "openPoints": 3}
  ],
  "recommendation": "Reassign unowned bugs first; chunk large unstarted cards."
}
```

`headline` is capped at 120 characters when polished by the LLM (140 in deterministic mode). When a real LLM is configured, `headline` is rewritten by `polish_headline`.

The server also emits a `recommendationDetail` extension on this response:

```json
{
  "recommendationDetail": {
    "text": "Reassign unowned bugs first; chunk large unstarted cards.",
    "strength": "strong",
    "basis": "Two unowned bugs with no recent activity.",
    "sources": [{"taskId": "t1", "taskName": "Fix bug", "storyPoints": 3}]
  }
}
```

`recommendationDetail` is built by `build_recommendation_detail(brief, drift, refs)` in `app/agents/catalog/board_brief.py`. Strength rules: `"strong"` when an `unowned_bug` signal is present OR `unowned > 3`; `"moderate"` on any other drift signal (`wip_overflow`, `stale_task`); `"none"` when no signals fired. `basis` is deterministically derived from the same data driving `recommendation`, capped at 140 characters. `sources` reuses the citation refs already emitted on `custom/citation`. The field is included in both the `suggestion` payload (v2.1 streaming path) and the `/api/v1/ai/board-brief` JSON response. The FE renders the legacy `recommendation` string as a fallback when `recommendationDetail` is absent, so older clients remain compatible.

**Status codes:** Same as `/task-draft`, plus:

| Code | Condition |
|---|---|
| 400 | `context` field is not an object |

---

### POST /api/v1/ai/search

Semantic search over tasks or projects using keyword overlap ranking.

**Auth:** Required. Project manager gate applied.

**Idempotency-Key:** Honoured.

**Envelope key for unwrapping:** `"search"`

**Request body (tasks search):**

```json
{
  "kind": "tasks",
  "query": "login authentication bug",
  "projectContext": {
    "project": {"_id": "proj_abc"},
    "tasks": [
      {"_id": "t1", "taskName": "Fix login crash", "note": "Safari only", "type": "bug", "epic": "Auth"},
      {"_id": "t2", "taskName": "Add dark mode", "note": "UI Polish", "type": "feature", "epic": "UI"}
    ]
  }
}
```

**Request body (projects search):**

```json
{
  "kind": "projects",
  "query": "acme authentication",
  "projectsContext": {
    "projects": [
      {"_id": "proj_abc", "projectName": "Acme Auth", "organization": "Acme Corp"}
    ]
  }
}
```

| Field | Type | Rules |
|---|---|---|
| `kind` | string | Required: `"tasks"` or `"projects"` |
| `query` | string | Required |
| `projectContext` | object | Required when `kind == "tasks"`. Contains `project._id` and `tasks[]`. |
| `projectsContext` | object | Required when `kind == "projects"`. Contains `projects[]`. |

**Response — 200 OK:**

```json
{
  "ids": ["t1"],
  "rationale": "Ranked by keyword overlap with the query (top 1)."
}
```

`ids` contains up to 10 matching IDs, ranked by Jaccard similarity score. When a real LLM is configured, the order and rationale are rewritten by `polish_search`.

The server also emits two extension fields on this response:

```json
{
  "matches": [
    {"id": "t1", "strength": "strong"}
  ],
  "expandedTerms": ["todo → backlog, inbox"]
}
```

`matches[]` is an array of `{id: string, strength: "strong" | "moderate" | "weak"}` objects, aligned 1:1 with `ids[]`. Strength is derived from the cosine similarity score of the unit-normalised embedding vectors produced by the `rank` node: `"strong"` if score ≥ 0.75, `"moderate"` if score ≥ 0.50, `"weak"` otherwise. The `polish` (LLM rerank) step recomputes `matches` so each id retains its embedding-derived strength after reordering. `expandedTerms[]` is a human-readable list of synonym expansions applied to the query; it is only present when the LLM reranker populates `expandedTerms` on the `SearchRanking` schema. The FE degrades gracefully to a flat `ids[]` rendering when these fields are absent.

**Status codes:** Same as `/task-draft`, plus:

| Code | Condition |
|---|---|
| 400 | `kind` is not `"tasks"` or `"projects"`, or `query` is not a string, or `context` is not an object |

---

### POST /api/v1/ai/chat

Multi-turn chat with the Board Copilot. Forwards to the `chat-agent` LangGraph runtime.

**Auth:** Required. Project manager gate applied using `context.project._id` from the payload.

**Idempotency-Key:** Honoured.

**Rate limit:** Inherited from `chat-agent` `AgentMetadata.rate_limit`.

**Request body:**

```json
{
  "messages": [
    {"role": "user", "content": "What tasks are overdue?"},
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {"id": "call_1", "name": "fe.listTasks", "arguments": {"project_id": "proj_abc"}}
      ]
    },
    {
      "role": "tool",
      "content": "{\"tasks\": [...]}",
      "toolCallId": "call_1"
    }
  ],
  "context": {
    "project": {"_id": "proj_abc"}
  }
}
```

Message roles:

| Role | Fields | Notes |
|---|---|---|
| `user` | `role`, `content` | `content` is redacted before the LLM sees it |
| `assistant` | `role`, `content`, `toolCalls?` | `toolCalls` is `[{id, name, arguments}]`; tool calls missing `id` or `name` are dropped |
| `tool` | `role`, `content`, `toolCallId` | Dropped if `toolCallId` does not match a prior assistant tool call |

**Response — 200 OK (text answer):**

```json
{"kind": "text", "text": "There are 3 overdue tasks: ..."}
```

**Response — 200 OK (model requested a tool):**

```json
{
  "kind": "tool_calls",
  "toolCalls": [
    {"id": "call_2", "name": "fe.listTasks", "arguments": {"project_id": "proj_abc"}}
  ]
}
```

When `kind == "tool_calls"`, the FE executes each named tool against its own client state, appends the results as `role: "tool"` messages, and posts the full conversation back. The FE caps this loop at 5 rounds. After the loop, the next response with `kind == "text"` carries the final answer.

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Response returned |
| 400 | `messages` is not a list |
| 401 | Missing or invalid JWT |
| 402 | Project budget exhausted |
| 403 | AI disabled for project or caller is not manager |
| 409 | Idempotency key in progress |
| 422 | Idempotency key reused with different body |
| 429 | Rate limit exceeded |
| 502 | LLM provider (chat-agent) error |

---

## 15. Agents v2.1 (`/api/v1/agents/*`)

Base path: `/api/v1/agents`

The agents router is **registry-driven**: any agent registered in `app.agents.registry` before boot is automatically listed, invokable, and streamable. The shipped catalog includes: `board-brief-agent`, `task-drafting-agent`, `task-estimation-agent`, `triage-agent`, `search-agent`, `chat-agent`.

All agent endpoints require a valid JWT. Policy gates — project AI disable flag, project manager check, rate limit, and token budget — are enforced on every invocation and streaming call.

### Shadow Agents

Agents with `status == "shadow"` are hidden from the list endpoint and return `404` on all call endpoints. Shadow agents are reserved for offline comparison runs.

### Deprecated Agents

Agents with `status == "deprecated"` remain callable but responses include:

```
Deprecation: true
```

### Payload Normalization

Both the flat form and the LangGraph SDK `{input, config}` envelope form are accepted and normalized before processing:

- `input` (singular) is aliased to `inputs` when `inputs` is absent.
- `config.configurable.thread_id`, `assistant_id`, `tags`, and `autonomy` are hoisted to top-level keys.
- `config.configurable.project_id` is forwarded into `inputs`.
- `config.configurable.user_id` is rejected with `400` (user identity comes from authentication).

---

### GET /api/v1/agents

List all registered agents (excludes `shadow` agents).

**Auth:** Required.

**Request:** No parameters.

**Response — 200 OK:**

```json
{
  "agents": [
    {
      "name": "task-drafting-agent",
      "description": "Drafts a task from a free-text prompt.",
      "version": "1.0.0",
      "tags": ["task", "draft"],
      "recursion_limit": 25,
      "context_schema": null,
      "status": "active",
      "rate_limit": {"per_minute": 60, "per_hour": 600},
      "allowed_autonomy": ["suggest", "plan"],
      "tools": ["fe.similarTasks", "fe.viewerContext"]
    }
  ]
}
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Agent list returned |
| 401 | Missing or invalid JWT |

---

### GET /api/v1/agents/_tools

Expose the FE-tool catalogue. Agents interrupt for FE-side data by naming a tool from this list. The FE can fetch this at session start to verify it implements every tool an agent might request.

**Auth:** Required.

**Request:** No parameters.

**Response — 200 OK:**

```json
{
  "tools": [
    {
      "name": "fe.listProjects",
      "description": "List projects visible to the current viewer.",
      "args_schema": {
        "type": "object",
        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100}},
        "additionalProperties": false
      },
      "result_schema": {
        "type": "object",
        "properties": {"projects": {"type": "array", "items": {"type": "object"}}},
        "required": ["projects"]
      }
    },
    {"name": "fe.listMembers", "description": "List members of a project.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"members": {"type": "array", "items": {"type": "object"}}}, "required": ["members"]}},
    {"name": "fe.getProject", "description": "Fetch a single project by id.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"project": {"type": "object"}}, "required": ["project"]}},
    {"name": "fe.listBoard", "description": "List columns + ordered task ids for a project board.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"columns": {"type": "array", "items": {"type": "object"}}}, "required": ["columns"]}},
    {"name": "fe.listTasks", "description": "List tasks in a project, optionally filtered.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}, "limit": {"type": "integer"}, "filter": {"type": "object", "description": "Optional filter object. All fields are optional. task_name: substring match (case-insensitive). type: one of 'bug', 'feature', 'spike'. coordinator_id: member id of the coordinator. column_id: board column id.", "properties": {"task_name": {"type": "string"}, "type": {"type": "string"}, "coordinator_id": {"type": "string"}, "column_id": {"type": "string"}}, "additionalProperties": false}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"tasks": {"type": "array", "items": {"type": "object"}}}, "required": ["tasks"]}},
    {"name": "fe.getTask", "description": "Fetch a single task by id.", "args_schema": {"type": "object", "properties": {"task_id": {"type": "string"}}, "required": ["task_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"task": {"type": "object"}}, "required": ["task"]}},
    {"name": "fe.boardSnapshot", "description": "Return a normalised board snapshot used by the brief and triage agents.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"project_id": {"type": "string"}, "columns": {"type": "array"}, "tasks": {"type": "array"}, "members": {"type": "array"}}}},
    {"name": "fe.similarTasks", "description": "Return tasks similar to a given prompt or draft for grounding.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}, "query": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["project_id", "query"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"similar": {"type": "array", "items": {"type": "object"}}}, "required": ["similar"]}},
    {"name": "fe.viewerContext", "description": "Return the current viewer's identity, role and preferences.", "args_schema": {"type": "object", "properties": {}, "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"user_id": {"type": "string"}, "role": {"type": "string"}, "preferences": {"type": "object"}}}},
    {"name": "fe.recentActivity", "description": "Return recent activity entries for a project.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"activity": {"type": "array", "items": {"type": "object"}}}, "required": ["activity"]}},
    {"name": "fe.formDraft", "description": "Return any draft the user has in-flight in a task creation form.", "args_schema": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"], "additionalProperties": false}, "result_schema": {"type": "object", "properties": {"draft": {"type": ["object", "null"]}}}}
  ]
}
```

Tool definitions are owned by `app/tools/fe_tool_schemas.py`. The FE uses these schemas as the contract for what to provide in a `command.resume` body after an `interrupt` event.

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Tool catalogue returned |
| 401 | Missing or invalid JWT |

---

### GET /api/v1/agents/{name}

Get metadata for a single agent.

**Auth:** Required.

**Path parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `name` | string | Agent name as registered (e.g. `"task-drafting-agent"`) |

**Response — 200 OK:**

```json
{
  "name": "task-drafting-agent",
  "description": "Drafts a task from a free-text prompt.",
  "version": "1.0.0",
  "tags": ["task", "draft"],
  "recursion_limit": 25,
  "context_schema": null,
  "status": "active",
  "rate_limit": {"per_minute": 60, "per_hour": 600},
  "allowed_autonomy": ["suggest", "plan"],
  "tools": ["fe.similarTasks", "fe.viewerContext"]
}
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Agent found |
| 401 | Missing or invalid JWT |
| 404 | Agent not found or is a shadow agent |

---

### POST /api/v1/agents/{name}/invoke

Run an agent to completion and return the final result as JSON.

**Auth:** Required. Rate limit, budget, and project-access gates applied.

**Idempotency-Key:** Honoured.

**Path parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `name` | string | Agent name |

**Request body (flat form):**

```json
{
  "inputs": {
    "prompt": "Draft a task for fixing the login crash",
    "project_id": "proj_abc"
  },
  "thread_id": "thread_xyz",
  "autonomy": "suggest"
}
```

**Request body (LangGraph SDK envelope form):**

```json
{
  "input": {
    "prompt": "Draft a task for fixing the login crash",
    "project_id": "proj_abc"
  },
  "config": {
    "configurable": {
      "thread_id": "thread_xyz",
      "autonomy": "suggest"
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `inputs` / `input` | object | Agent-specific state inputs. `project_id` is used for budget and access gates. |
| `thread_id` | string | Optional. LangGraph checkpoint thread ID for stateful agents. |
| `assistant_id` | string | Optional. LangGraph assistant ID. |
| `tags` | string[] | Optional. Tracing tags. |
| `autonomy` | string | Optional. Must be one of `"suggest"`, `"plan"`, `"auto"` and must be in the agent's `allowed_autonomy`. |
| `context` | object | Optional. Agent-specific context object (only for agents that declare `context_schema`). |
| `command` | object | Optional. Resume a paused agent (see below). Mutually exclusive with `inputs`. |
| `command.resume` | any | The value returned by the FE tool to resume the agent. |
| `user_id` | — | Rejected with `400` — user identity is always derived from the JWT. |

**Redaction:** `inputs.prompt` and `inputs.messages[].content` (where `role == "user"`) are redacted server-side before the agent sees them.

**Response — 200 OK:**

```json
{
  "result": {
    "messages": [...],
    "taskName": "Fix login crash",
    "storyPoints": 3
  },
  "usage": {
    "tokensIn": 412,
    "tokensOut": 89
  }
}
```

`result` is the agent's final LangGraph state dict. `usage` is a best-effort extraction from the trailing message metadata; it may be `{"tokensIn": 0, "tokensOut": 0}` for agents that do not report usage.

**Resume request body:**

```json
{
  "thread_id": "thread_xyz",
  "command": {
    "resume": {
      "project_id": "proj_abc",
      "columns": [{"_id": "col_a", "columnName": "To Do"}],
      "tasks": [],
      "members": [{"_id": "user1", "username": "alice"}]
    }
  }
}
```

**Status codes:**

| Code | Condition |
|---|---|
| 200 | Agent completed |
| 400 | Invalid body fields, invalid autonomy level, `inputs` and `command.resume` both present, `user_id` in body |
| 401 | Missing or invalid JWT |
| 402 | Project budget exhausted |
| 403 | AI disabled for project, caller is not manager, or autonomy level not allowed |
| 404 | Agent not found or is shadow |
| 409 | Idempotency key in progress |
| 422 | Idempotency key reused with different body |
| 429 | Rate limit exceeded |
| 504 | Agent run exceeded `AGENT_REQUEST_TIMEOUT_SECONDS` (default 120 s) |

---

### POST /api/v1/agents/{name}/stream

Run an agent and stream results as Server-Sent Events. This is the primary endpoint for the Board Copilot UI.

**Auth:** Required. Rate limit, budget, and project-access gates applied.

**Idempotency-Key:** Honoured on the initial request (same semantics as `/invoke`); the cached body for a successful stream is a `{"status": "stream_completed"}` JSON marker, not a re-stream of the SSE body — replays return that marker as a 200 response with `Idempotent-Replay: true`. Resume requests (those carrying a `thread_id` from a prior interrupt) bypass the idempotency check. The slot is released if the stream errors so a real retry with the same key can proceed.

**Path parameter:**

| Parameter | Type | Notes |
|---|---|---|
| `name` | string | Agent name |

**Request body:** Same as `/invoke` (see above, including the LangGraph SDK envelope form and `command.resume`).

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Response:** Stream of SSE frames. See [Section 7](#7-sse-event-format-agents-stream) for the full event-type reference.

**Complete streaming example:**

```
data: {"type": "updates", "ns": [], "data": {"__start__": {}}}

data: {"type": "messages", "ns": [], "data": [{"content": "Draft", "type": "ai"}, {}]}

data: {"type": "messages", "ns": [], "data": [{"content": "ing", "type": "ai"}, {}]}

data: {"type": "interrupt", "ns": [], "data": {"tool": "fe.similarTasks", "args": {"project_id": "proj_abc", "query": "login crash"}}}

data: [DONE]
```

After the `interrupt` frame, the client resumes by calling `/stream` again with `command.resume`.

**Notable behaviour:**

- The gate checks (rate limit, budget, project access) run **before** the stream opens, so a `429` or `402` is returned as a regular JSON error response, not an SSE frame.
- When the client disconnects, the server closes the LangGraph stream to stop token billing.
- A per-call timeout (default `AGENT_REQUEST_TIMEOUT_SECONDS` = 120 s) is enforced. On timeout an `error` frame is emitted then `[DONE]`.
- After the stream completes, the true token usage is reconciled against the pre-booked budget reservation.

**Status codes (pre-stream gate rejections):**

| Code | Condition |
|---|---|
| 400 | Invalid body |
| 401 | Missing or invalid JWT |
| 402 | Project budget exhausted |
| 403 | AI disabled for project, caller is not manager, or autonomy level not allowed |
| 404 | Agent not found or is shadow |
| 429 | Rate limit exceeded |

Mid-stream errors arrive as `{"type": "error", ...}` SSE frames followed by `[DONE]`.

---

## Unimplemented Endpoints

### /mcp

The MCP (Model Context Protocol) transport mount point does not exist. The tool schemas (`app/tools/fe_tool_schemas.py`) and per-agent `tools` tuples on `AgentMetadata` are present, but `langchain-mcp-adapters` is not in any dependency group and no `/mcp` route is registered.

See [`../status/release-todo.md`](../status/release-todo.md) §15 for the planned scope when this is prioritised (Streamable HTTP transport at `/mcp`, exposing the read-only FE tools).

### search-agent v2.1 graph

`search-agent` is `status == "active"`: it appears in `GET /api/v1/agents` and accepts both `POST /api/v1/agents/search-agent/invoke` and `POST /api/v1/agents/search-agent/stream`. The graph is `fetch_candidates → rank → polish → emit`:

1. `fetch_candidates` — raises `interrupt(interrupt_payload("fe.searchCandidates", {project_id, query, kind, limit}))`. The FE resumes with `{"candidates": [{"id", "text"}, ...]}`.
2. `rank` — embeds the query and every candidate text via `be_tools.embed`, scores by cosine similarity via `be_tools.embedding_neighbors(query_vec, corpus, k=10)`, and builds a deterministic `{ids, rationale}`.
3. `polish` — passes the deterministic ranking to `polish_search` (LLM rerank when a real model is configured, deterministic fallback on stub) and emits `{"kind": "usage", "tokensIn", "tokensOut"}`.
4. `emit` — emits `{"kind": "suggestion", "surface": "search", "payload": ranking}` and appends a final `AIMessage` with the JSON ranking so the messages channel also surfaces it.

`tools = ("fe.searchCandidates", "be.embed", "be.embedding_neighbors")`, `recursion_limit = 8`, `allowed_autonomy = ("suggest",)`. The v1 shim at `POST /api/v1/ai/search` continues to call `polish_search` directly and is unchanged.

### triage-agent LLM integration

The rules engine in `app/tools/be_tools.detect_drift` remains the source of truth for *which* signals fire and at what severity. With `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, `polish_triage` (in `app/agents/catalog/triage.py`) rewrites each nudge `summary` field with signal-specific context (e.g. "WIP overflow in 'In Progress' (8/5)" instead of the generic "WIP overflow"); without a key the deterministic `_NUDGE_TITLES` string is used. Token usage flows through the standard `emit_custom({"kind": "usage", ...})` event.
