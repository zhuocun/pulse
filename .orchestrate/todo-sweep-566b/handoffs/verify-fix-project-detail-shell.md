<!-- orchestrate handoff
task: verify-fix-project-detail-shell
branch: `orch/todo-sweep-566b/fix-project-detail-shell` (verifier-only commit: `chore: add verifier log for fix-project-detail-shell`; artifact `verifier-artifacts/fix-project-detail-shell-verification.log`)
agentId: bc-2db698aa-9427-4ed7-943b-656c9943de16
runId: run-756b8112-9428-4e19-b786-759147e56553
resultStatus: finished
finishedAt: 2026-05-11T04:54:30.765Z
-->

## Verification

**`unit-test-verified`** — Targeted Jest suites (including `projectDetailPage.breadcrumb.test.tsx`) pass; ESLint on touched paths and `tsc --noEmit` pass. No live browser session was run.

## Target

`fix-project-detail-shell` on branch `orch/todo-sweep-566b/fix-project-detail-shell`

## Branch

`orch/todo-sweep-566b/fix-project-detail-shell` (verifier-only commit: `chore: add verifier log for fix-project-detail-shell`; artifact `verifier-artifacts/fix-project-detail-shell-verification.log`)

## Execution

- → `npm install` — completed successfully (deps already satisfied).
- → `CI=true npm test -- --watchAll=false --runInBand src/pages/projectDetail src/components/breadcrumb` — **passed** (1 suite, 2 tests); **does not pick up** `src/__tests__/projectDetailPage.breadcrumb.test.tsx`.
- → `CI=true npm test -- --watchAll=false --runInBand src/pages/projectDetail.test.tsx src/__tests__/projectDetailPage.breadcrumb.test.tsx` — **passed** (2 suites, 3 tests): redirect to `/projects/project-1/board`, breadcrumb `Projects` link + `aria-current="page"` on project name, source guard against `\b5\s+px\b`, `shadow.sm` present, conditional computed `box-shadow` check.
- → `npx eslint --max-warnings 0` on `projectDetail.tsx`, `projectDetail.test.tsx`, `projectDetailPage.breadcrumb.test.tsx`, `en.ts`, `zh-CN.ts` — **passed** (used `npx` instead of `npm run eslint` to avoid repo-wide `--fix` on verification-only runs).
- → `npx tsc --noEmit` — **passed**.
- → Static checks: `rg`/read of `src/pages/projectDetail.tsx` — **no** `5 px`; **no** `grid` / `aside` / `ProjectPopover`; `<Breadcrumb items={[...]}>` with `<Link to="/projects">` and last crumb `<span aria-current="page">`; `useEffect` still `navigate("board", …)` when path does not end with `/board`.
- → i18n: `microcopy.breadcrumb.projects` in `src/i18n/locales/en.ts` (“Projects”) and `src/i18n/locales/zh-CN.ts` (“项目”) — **paired**.

## Findings

Per acceptance criterion:

- [x]: **`src/pages/projectDetail.tsx` shell** — **met**: single-column `Container` / sticky `TopBar` / `Body`; AntD `Breadcrumb` with `items`; no 2-column grid or left aside.
- [x]: **No broken `5 px` shadow literal** — **met**: file uses `box-shadow: ${shadow.sm}`; tests assert source does not match `\b5\s+px\b` and references `shadow.sm`.
- [x]: **`/projects/:projectId` → `.../board`** — **met**: covered by both test files + implementation unchanged in spirit (`navigate("board")` when path lacks `/board`).
- [x]: **Tests / Jest green for touched behavior** — **met** for explicit project-detail tests + breadcrumb suite; full repo Jest **not** executed.
- [x]: **i18n `microcopy.breadcrumb.*` en + zh-CN** — **met**: `breadcrumb.projects` in both locales.

Verifier-specific:

- [x]: **`5 px` gone; breadcrumb accessible** — **met** via tests (`getByRole("link", { name: "Projects" })`, `href`, `aria-current="page"` on current crumb) plus source/tokenized shadow; AntD breadcrumb list semantics assumed from library (not exercised in a real browser).
- [x]: **Redirect survives shell collapse** — **met** (tests + code review).
- [x]: **Verification class** — **`unit-test-verified`** (see above).

Other findings (severity-ordered):

- **(med)**: The written verify recipe’s Jest globs **`src/pages/projectDetail` + `src/components/breadcrumb`** omit `src/__tests__/projectDetailPage.breadcrumb.test.tsx`, so the “new test” is skipped unless the command is extended (e.g. add `src/__tests__/projectDetailPage` or the explicit file path).
- **(low)**: No **`live-ui-verified`** dev-server / DOM walk; planner should treat interactive polish as test-backed only unless someone runs the optional manual step.

## Notes & suggestions

- Recommend updating the orchestrator verify recipe to include `src/__tests__/projectDetailPage` (or the breadcrumb test filename) so CI and future verifiers always run the breadcrumb regression suite.
- Verifier push adds **`verifier-artifacts/fix-project-detail-shell-verification.log`** on the same branch as the worker PR; integrate or drop that commit if the PR should stay worker-only.