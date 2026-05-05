# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

FastAPI backend (Python 3.12) for a Jira-like project management app. Six LangGraph-based AI agents ship alongside standard CRUD routes. Default database is MongoDB; AI features use deterministic stubs when no LLM API key is set.

### Running the dev server

```bash
source /workspace/.venv/bin/activate
mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017 &
uvicorn app.main:app --reload --port 8000
```

The `.env` must have `MONGO_URI=mongodb://localhost:27017/jira` and a `UUID` of at least 32 characters (e.g. `dev-only-jwt-secret-change-me-32-bytes-long`). Copy `.env.example` to `.env` and update those two values.

### Lint

```bash
ruff check .
```

`api/index.py` triggers F401 (Vercel re-export shim) — this is expected. Exclude it or ignore the single warning.

### Tests

```bash
python -m pytest
```

Tests use an in-memory `FakeStore` and `fakeredis`; **no external services needed**. Coverage must be 100% (configured in `pyproject.toml`). The full `[ai]` extra must be installed for all 722 tests to pass (observability tests need `opentelemetry-*` and `prometheus-client`).

### AI-specific environment variables

| Variable | Default | Description |
|---|---|---|
| `AI_MAX_BODY_BYTES` | `65536` (64 KiB) | Maximum serialised JSON body size for all v1 and v2.1 AI endpoints. Requests exceeding this return HTTP 413. |
| `AI_MAX_PROMPT_BYTES` | `8192` (8 KiB) | Maximum byte length for a single `prompt` string field. |
| `AI_MAX_MESSAGES` | `50` | Maximum number of entries in a `messages` list (top-level or under `inputs.messages`). |
| `AI_MAX_MESSAGE_CONTENT_BYTES` | `8192` (8 KiB) | Maximum byte length for a single message `content` field. |
| `EMBEDDINGS_DIMENSIONS` | `16` | Dimensions passed to `OpenAIEmbeddings(dimensions=...)`. Default `16` preserves backward compat with the SHA-256 stub. Set `512` or higher when using real OpenAI embeddings in production. The stub path ignores this and always returns 16-dim vectors. |

### Key gotchas

- **MongoDB must be running** before starting the dev server — the app connects at import time (`app/database.py`), not lazily.
- **Trailing slashes** matter for FastAPI routes: POST to `/api/v1/projects/` (with slash), not `/api/v1/projects`. Without the slash you get a 307 redirect that drops the POST body.
- **`UUID` env var** is the JWT signing secret. If it's shorter than 32 characters the server refuses to start.
- All AI agents fall back to **deterministic stubs** without `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, so the app is fully functional for CRUD and agent-endpoint testing without any LLM keys.
- The `[dev]` extra alone is **not enough** to run the full test suite — install `".[dev,ai]"` (or `".[dev]"` then `".[ai]"` separately) so the observability tests find their imports.
