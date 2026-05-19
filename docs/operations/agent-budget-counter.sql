-- Per-(project, month) token budget counter for the Board Copilot agent.
-- Run once per Postgres cluster (same DB as LangGraph checkpoints is typical).
--
-- Backs :class:`app.middleware.budget_pg.PostgresBudgetBackend`. The
-- ``INSERT ... ON CONFLICT (project_id, period_key) DO UPDATE`` upsert
-- with ``RETURNING tokens_used, requests_made`` lets the gate atomically
-- increment-and-check in a single round-trip, so two workers reserving
-- the last slot can't both pass — Postgres serialises them on the row
-- lock. This is the multi-worker-safe alternative to the Redis backend
-- when the deploy already uses Postgres but not Redis.

CREATE TABLE IF NOT EXISTS agent_budget_counter (
    project_id     text        NOT NULL,
    period_key     text        NOT NULL,
    tokens_used    bigint      NOT NULL DEFAULT 0,
    requests_made  bigint      NOT NULL DEFAULT 0,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, period_key)
);

CREATE INDEX IF NOT EXISTS agent_budget_counter_period_key
    ON agent_budget_counter (period_key);
