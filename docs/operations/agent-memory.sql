-- Durable agent memory store for the Board Copilot agent.
-- Run once per Postgres cluster (same DB as LangGraph checkpoints is typical).
--
-- Backs :class:`app.agents.memory_store_pg.PostgresMemoryStore`. The unique
-- key ``(project_id, user_id, kind, key)`` is used as the ``ON CONFLICT``
-- target for upsert-on-remember; the partial unique index handles the
-- ``user_id IS NULL`` case (project-wide scope) because Postgres treats
-- ``NULL`` as distinct in plain unique constraints.

CREATE TABLE IF NOT EXISTS agent_memory (
    id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id  text        NOT NULL,
    user_id     text        NULL,
    kind        text        NOT NULL,
    key         text        NOT NULL,
    value       jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NULL
);

-- Two indexes so the unique-with-NULL semantics work for both
-- project-wide (user_id IS NULL) and per-user scopes. Postgres treats
-- NULLs as distinct in plain UNIQUE constraints, so a single composite
-- constraint over ``(project_id, user_id, kind, key)`` would allow
-- duplicate project-wide entries.
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_scope_user_key
    ON agent_memory (project_id, user_id, kind, key)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_scope_project_key
    ON agent_memory (project_id, kind, key)
    WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS agent_memory_scope_lookup
    ON agent_memory (project_id, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_memory_expires_at
    ON agent_memory (expires_at)
    WHERE expires_at IS NOT NULL;
