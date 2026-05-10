-- pgvector extension and task embedding table for AGENT_VECTOR_SEARCH_ENABLED.
-- Run once per Postgres cluster (same DB as LangGraph checkpoints is typical).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS task_embeddings (
    project_id text NOT NULL,
    task_id text NOT NULL,
    label text NOT NULL,
    embedding vector(512) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, task_id)
);

-- After the first bulk load, create an ANN index with a matching dimension,
-- e.g. CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);
