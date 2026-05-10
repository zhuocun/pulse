# Bootstrap (read first)

Parent planner: agent id `bc-8982741d-63f7-4d26-ba3a-c37f9a00979e` (`plan.selfAgentId`).

## Scoped backlog (this run)

### FE CI — `docs/status/release-todo.md` §7b + `docs/status/ui-todo.md` §1.2 item 20d

- `.github/workflows/` currently has only `backend-ci.yml`.
- Add `.github/workflows/frontend-ci.yml`; scope to FE paths (`src/**`, `package.json`, `package-lock.json`, `vite.config.ts`, `jest.config.cjs`, `tsconfig.json`, `eslint.config.mjs`, `.github/workflows/frontend-ci.yml`).
- Mirror `backend-ci.yml` shape: `push`/`pull_request` to `main` and `claude/**`.
- Gates: install (repo root), `prettier --check`, eslint **without** mutating the tree (pre-commit uses `eslint` script with `--fix` — CI should **check** only), `npm run typecheck`, `CI=true npm test -- --watchAll=false --runInBand`, `npm run build`.
- AGENTS.md: closing this item → strike/remove from `release-todo.md` §7b and `ui-todo.md` §20d; one-liner in `docs/status/product-done.md`.

### CopilotAboutPopover — `docs/status/ui-todo.md` §1.2 item 20c

- `src/components/copilotAboutPopover/index.tsx:105` — mode tags `"Remote model"` / `"Local engine"` must be i18n (`en`, `zh-CN`), e.g. `microcopy.about.remoteModeLabel` / `localModeLabel`.
- `:114` — knowledge cutoff: remove static drift; prefer `REACT_APP_*` build-time constant **or** extend `AgentMetadata` + `getAgentMetadata` consumer if BE already exposes a field (check `backend` OpenAPI / wire); add types in `src/interfaces/agent.d.ts` if needed.
- Tests: update any snapshots; keep jest-axe green.

### Design tokens doc — `docs/status/ui-todo.md` §2.C + §3 suggested order

- Create `docs/design-tokens.md` describing `src/theme/tokens.ts` and `src/theme/antdTheme.ts` (spacing, palette, typography, motion, AntD mapping).
- AGENTS.md status: move item from §20e to done in `product-done.md` and strike §20e reference.

## Repo constraints

- Follow `AGENTS.md` (hook ordering for `useAgent`, etc.).
- User-facing strings: avoid `§` in UI copy.
