# Agent streams: resume, idempotency, and retries

Support and operators use this guide when diagnosing duplicate work,
`409` / `422` responses, or “nothing happened after reload” reports on
`POST /api/v1/agents/{name}/stream`.

## Thread id vs Idempotency-Key

| Handle | Scope | Purpose |
| --- | --- | --- |
| `config.configurable.thread_id` (FE `useAgent.threadId`) | LangGraph checkpoints; persisted in `sessionStorage` per `(agentName, projectId)` | Same logical conversation and interrupt resume across refreshes in that tab |
| `Idempotency-Key` HTTP header | Initial **non-resume** POST only (generated per stream open in the FE client) | Prevents double billing / duplicated **first** stream open on flaky networks |

Resume and `command.resume` bodies do **not** participate in idempotency
keying; duplicate work is prevented by checkpoint state on the server.

## HTTP outcomes

- **`200` + `text/event-stream`**: live SSE. First-class events include
  `messages`, `custom/*`, and terminal usage markers.
- **`200` + JSON + `Idempotent-Replay: true`**: replay of a prior
  completed stream for the same idempotency slot (`{"status":
  "stream_completed"}`). Safe: the graph is not started again.
- **`409`** (`idempotency_key_in_progress`): same key is still tied to an
  in-flight initial stream. Wait for completion or surface a “still
  running” message; do **not** assume the turn failed.
- **`422`** (`idempotency_key_reused`): same key was reused with a
  **different** request fingerprint. Client must generate a fresh key for a
  genuinely new operation (never reuse a key for different payloads).

## Failure / retry policy

- **Transport or mid-stream parse failure**: the FE clears the in-flight
  state; a new `Idempotency-Key` is generated on the next `start()`. The
  thread id is **not** rotated unless the user hits reset — interrupts can
  still be resumed unless the user explicitly starts a new thread.
- **Watchdog / stall**: the client aborts and shows a timeout-style
  message; user can retry. Checkpoint state on the server determines whether
  the next call continues or restarts from a clean thread (same `thread_id`
  unless reset on the client).

## Multi-worker deployments

With `UVICORN_WORKERS` / `WEB_CONCURRENCY` &gt; 1, Redis-backed rate limit,
budget, and idempotency (`REDIS_URI`) are required or the process refuses to
boot. See [`deployment.md`](deployment.md).
