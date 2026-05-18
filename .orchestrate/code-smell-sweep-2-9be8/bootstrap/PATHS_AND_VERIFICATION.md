# Paths and verification — code-smell-sweep-2-9be8

Discovery: `.orchestrate/code-smell-sweep-2-9be8/discovery/CODE-SMELL-AUDIT-R2.md`

## FE

```bash
npm ci
npm run eslint -- --max-warnings 0
npx tsc --noEmit
CI=true npm test -- --watchAll=false --runInBand <scoped paths>
```

## BE

```bash
cd backend && python -m pytest tests/test_board_brief.py tests/test_tools.py -q
cd backend && ruff check app/agents/catalog/board_brief.py app/tools/
```

## Merge branch

`orch/code-smell-sweep-2-9be8/merge-code-smell-sweep-2`
