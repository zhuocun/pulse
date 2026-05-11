## FE verification (after Copilot/metadata tasks)

From `docs/todo/release-todo.md` FE block:

```bash
npm ci
npm run eslint
npx tsc --noEmit
CI=true npm test -- --watchAll=false --runInBand
npx vite build
```

## BE verification (after compose / infra tasks)

From `backend/AGENTS.md` / release doc:

```bash
cd backend
python -m pytest
ruff check .
```

## Files this plan expects workers to honour

- `bootstrap/BACKLOG_OPEN_NON_GA.md` — scope authority for non-GA slices
- Repo `AGENTS.md` — backlog single source of truth in `docs/todo/`
