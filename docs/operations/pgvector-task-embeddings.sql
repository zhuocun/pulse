-- pgvector extension and task embedding table for AGENT_VECTOR_SEARCH_ENABLED.
-- Run once per Postgres cluster (same DB as LangGraph checkpoints is typical).
--
-- Enablement order:
--   1. Set EMBEDDINGS_PROVIDER=openai and matching EMBEDDINGS_DIMENSIONS /
--      AGENT_VECTOR_DIMENSIONS values.
--   2. Run this SQL against the same database resolved by AGENT_POSTGRES_URI
--      or POSTGRES_URI.
--   3. From the backend env, dry-run then execute the resumable backfill:
--        python backend/scripts/backfill_task_embeddings.py --prune-deleted
--        python backend/scripts/backfill_task_embeddings.py --execute --prune-deleted
--   4. Enable AGENT_VECTOR_SEARCH_ENABLED=true only after the JSON summary
--      reports the expected scanned/written/skipped/prunedDeleted counts.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS task_embeddings (
    project_id text NOT NULL,
    task_id text NOT NULL,
    label text NOT NULL,
    embedding vector(512) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, task_id)
);

-- After the first successful bulk load, create an ANN index with a matching
-- dimension and operator class. For cosine search:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_embeddings_embedding_hnsw
--     ON task_embeddings USING hnsw (embedding vector_cosine_ops);
