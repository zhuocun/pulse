# Cursor Cloud — environment notes

Setup gotchas for running this monorepo inside Cursor Cloud (or any
similar ephemeral VM with restricted permissions). The information
below was previously split between the root `AGENTS.md` and
`backend/AGENTS.md`; treat this file as the single source of truth.

## Frontend (Vite SPA)

- Standard scripts live in `package.json`; `npm start` serves the app
  on port 3000.
- **Node.js 24** is required (`.nvmrc`). Load nvm before running any
  npm/node command:
  ```bash
  export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"
  ```
- Browser E2E tests should not depend on the default remote API:
  `https://pulse-python-server.vercel.app` can return 403 from this
  environment, and the checked-in `__json_server_mock__` data is stale
  relative to the current `/api/v1` frontend contract. Use Playwright
  route mocks or an API-compatible local mock when exercising
  authenticated project and board flows.
- If changing `REACT_APP_API_URL`, restart Vite because
  `vite.config.ts` inlines the value into `process.env.REACT_APP_API_URL`.
- `CI=true npm test` runs the FE Jest suite; bump
  `NODE_OPTIONS=--max-old-space-size=4096` if OOM.
- The frontend's remote API
  (`https://pulse-python-server.vercel.app`) works from this
  environment for basic CRUD (registration, login, projects, tasks).
  The local backend at `:8000` is a full alternative; set
  `REACT_APP_API_URL=http://localhost:8000` in `.env.development` to
  use it (requires Vite restart).

## Backend (FastAPI)

Product overview: FastAPI backend (Python 3.12) for the project
management app. Six LangGraph-based AI agents ship alongside
standard CRUD routes. Default database is MongoDB; AI features use
deterministic stubs when no LLM API key is set.

### Running the dev server

```bash
source /workspace/.venv/bin/activate
mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017 &
uvicorn app.main:app --reload --port 8000
```

The standard `mongod --fork` command fails in Cursor Cloud due to a
`/tmp/mongodb-27017.sock` permission error. Use a config file that
disables the Unix socket:

```bash
cat > /tmp/mongod.conf <<EOF
net:
  bindIp: 127.0.0.1
  port: 27017
  unixDomainSocket:
    enabled: false
storage:
  dbPath: /data/db
EOF
mongod --config /tmp/mongod.conf &
```

Run it in a background tmux session or with `&`; wait ~2 s before
hitting the port.

### Backend `.env`

`backend/.env` needs `MONGO_URI=mongodb://localhost:27017/jira`. `UUID`
is **optional** — when unset, the lifespan mints a 32-byte random secret
on first boot and persists it to the Mongo `system_config` collection.
Set `UUID=<32+char hex>` only if you want to pin a known value (e.g. to
share with a legacy Express signer).

### Lint

```bash
ruff check .
```

`api/index.py` triggers F401 (Vercel re-export shim) — this is
expected. Exclude it or ignore the single warning.

### Tests

```bash
python -m pytest
```

Tests use an in-memory `FakeStore` and `fakeredis`; **no external
services needed**. Coverage must stay above the 85% floor configured in
`pyproject.toml` (real coverage is ~98%). The full `[ai]` extra must be
installed for the
entire suite to pass (observability tests need `opentelemetry-*` and
`prometheus-client`):

```bash
pip install -e ".[dev,ai]"
```

Backend tests use in-memory fakes and do **not** require MongoDB.

### Key gotchas

- **MongoDB must be running** before starting the dev server — the
  app connects at import time (`app/database.py`), not lazily.
- **Trailing slashes** matter for FastAPI routes: POST to
  `/api/v1/projects/` (with slash), not `/api/v1/projects`. Without
  the slash you get a 307 redirect that drops the POST body.
- **`UUID` env var** is the JWT signing secret. It is **optional**; the
  lifespan bootstraps and persists a random secret in Mongo when unset.
  A `UUID` that is *set but shorter than 32 chars* still refuses
  startup.
- Run `curl -s localhost:8000/api/v1/health/ai | jq .` after boot to
  see resolved provider, checkpointer backend, and warnings.
  `?probe=true` adds a free `models.list()` LLM connectivity check
  (cached 30s).
- All AI agents fall back to **deterministic stubs** without
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `DEEPSEEK_API_KEY`, so the
  app is fully functional for CRUD and agent-endpoint testing without
  any LLM keys.
- The `[dev]` extra alone is **not enough** to run the full test
  suite — install `".[dev,ai]"` (or `".[dev]"` then `".[ai]"`
  separately) so the observability tests find their imports.
- AI router tests should override `get_rate_limiter` /
  `get_budget_tracker` (or seed `app.state.rate_limiter` /
  `app.state.budget_tracker`) instead of mutating module singletons.
  The production app now owns fresh limiter/budget backends per
  lifespan; the module globals are only the fallback path for
  mini-app/unit tests that bypass lifespan startup.

### AI-specific environment variables

| Variable | Default | Description |
|---|---|---|
| `AI_MAX_BODY_BYTES` | `65536` (64 KiB) | Maximum serialised JSON body size for all v1 and v2.1 AI endpoints. Requests exceeding this return HTTP 413. |
| `AI_MAX_PROMPT_BYTES` | `8192` (8 KiB) | Maximum byte length for a single `prompt` string field. |
| `AI_MAX_MESSAGES` | `50` | Maximum number of entries in a `messages` list (top-level or under `inputs.messages`). |
| `AI_MAX_MESSAGE_CONTENT_BYTES` | `8192` (8 KiB) | Maximum byte length for a single message `content` field. |
| `EMBEDDINGS_DIMENSIONS` | `16` | Dimensions passed to `OpenAIEmbeddings(dimensions=...)`. Default `16` preserves backward compat with the SHA-256 stub. Set `512` or higher when using real OpenAI embeddings in production. The stub path ignores this and always returns 16-dim vectors. |
