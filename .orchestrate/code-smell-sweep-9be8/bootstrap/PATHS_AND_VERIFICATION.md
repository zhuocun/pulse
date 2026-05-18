# Paths and verification — code-smell-sweep-9be8

## Discovery authority

`.orchestrate/code-smell-sweep-9be8/discovery/CODE-SMELL-AUDIT.md`

## FE verification (per worker slice)

```bash
npm ci
npm run eslint -- --max-warnings 0
npx tsc --noEmit
CI=true npm test -- --watchAll=false --runInBand <paths from task verify block>
```

## BE verification

```bash
cd backend
python -m pytest tests/test_vector_augmented_agents.py tests/test_task_vector_pg.py -q
ruff check app/agents/catalog/task_estimation.py app/agents/catalog/search.py app/agents/catalog/_shared.py
```

## Branch naming

`orch/code-smell-sweep-9be8/<task-name>`

## Merge order (merge worker)

1. fix-use-react-mutation-types
2. fix-dnd-clone-types
3. fix-project-modal-errors
4. fix-ai-task-assist-smells
5. extract-use-agent-thread-persist
6. be-catalog-vector-dedup

Union i18n/microcopy conflicts: N/A for this sweep (no locale edits planned).
