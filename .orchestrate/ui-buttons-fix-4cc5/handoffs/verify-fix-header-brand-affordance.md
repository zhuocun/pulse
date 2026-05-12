<!-- orchestrate handoff
task: verify-fix-header-brand-affordance
branch: `orch/ui-buttons-fix-4cc5/fix-header-brand-affordance` (includes verifier-only commit recording execution: `.verifier/fix-header-brand-affordance.execution.log`, commit `c07b492`; no edits to implementation files)
agentId: bc-b7e09955-ca66-40d5-885b-d746e3984e52
runId: run-eec4d4fa-bbc7-4275-b5f1-d3063dd94e08
resultStatus: finished
finishedAt: 2026-05-12T14:47:07.121Z
-->

## Verification

Pick the strongest claim your `## Execution` evidence supports:

- **`unit-test-verified`**: Targeted RTL suites exercising the header and strict UI keyboard behaviors all pass (`55` tests); `eslint`/`tsc` pass on checked paths. Live browser verification on real `/projects` vs board was **not** re-run here (auth/session bootstrap needed for full SPA smoke); observable behavior matches acceptance via tests and implementation read-through.

## Target

`fix-header-brand-affordance` on branch `orch/ui-buttons-fix-4cc5/fix-header-brand-affordance`

## Branch

`orch/ui-buttons-fix-4cc5/fix-header-brand-affordance` (includes verifier-only commit recording execution: `.verifier/fix-header-brand-affordance.execution.log`, commit `c07b492`; no edits to implementation files)

## Execution

- **`CI=true npm test -- --watchAll=false --runInBand src/components/header src/__tests__/uiKeyboardNavigation.strict.test.tsx src/__tests__/uiQuality.strict.test.tsx`** → `Test Suites: 3 passed, 3 total` / **`Tests: 55 passed`**
- **`npx eslint --max-warnings 0 src/components/header`** → exit `0`, no output (parity with linting header subtree **without** the repo-wide `eslint --fix` from `npm run eslint`, which would violate “do not modify target source files”)
- **`npx tsc --noEmit`** → exit `0`, no output

## Findings

Per acceptance criterion:

- **`On /projects`, the Pulse brand is not exposed as a redundant clickable button that does nothing.**: **[x]** met — implementation uses **`BrandPresentation` (`styled.span`)** without `BrandLink` / `NoPaddingButton`; **`Header`** tests **`does not navigate when already on the projects list`** and **`omit[s] Pulse brand from tab order on /projects`** assert no **`button`** named **`pulse home`** in the **`banner`**; **`uiKeyboardNavigation.strict`** aligns first Tab to **`Members`** after **`/projects`**
- **`From other routes`, clicking the brand still navigates to `/projects`.**: **[x]** met — **`navigates to projects with viewTransition when the logo is clicked outside the projects list`**, **`navigates to /projects ... from the keyboard`** (Enter); non-`/projects` path uses **`BrandLink`** with **`navigate("/projects", { viewTransition: true })`**
- **`Tests cover the regression; eslint + tsc clean.`**: **[x]** met — same Jest harness + ESLint/max-warnings 0 + `tsc`; regression coverage spans **`src/components/header/index.test.tsx`** and **`src/__tests__/uiKeyboardNavigation.strict.test.tsx`**

**Verifier-specific:**

- **`Verifier confirms role/tab semantics match acceptance.`**: **[x]** met — **`/projects`**: `queryByRole("button", { name: /pulse home/i })` absent; **`off /projects`**: `getByRole("button", { name: /pulse home/i })` is first Tab stop before **`Members`** (`MemberPopover` mock is a **`button`** for realistic order)
- **`Verifier records a strong verification class or blocker notes.`**: **[x]** **`unit-test-verified`** (not **`live-ui-verified`**) documented above

Other findings (severity-ordered):

- **(med)**: Worker’s scripted check was **`npm run eslint`** (implicit **`--fix`**, broad globs); this verifier substituted **`npx eslint --max-warnings 0 src/components/header`** to avoid rewriting tracked sources — same outcome for the header subtree in this env (clean exit).

- **(low)**: No new independent screen recording was produced here; planner may still weigh upstream’s **`/opt/cursor/artifacts/header-brand-affordance-fix.mp4`** separately from this verifier run.

## Notes & suggestions

- Implementation reference: **`path === "/projects"`** renders **`BrandPresentation`** (non-interactive **`span`**); elsewhere **`BrandLink`** keeps **`microcopy.header.logoLabel`** on **`aria-label`** / **`title`** and **`onClick`** → **`navigate("/projects", { viewTransition: true })`**.
- For **`live-ui-verified`** later, scripted checks could seed **`Token`** in **`localStorage`** and **`react-query`** user cache (`["users"]`) before loading **`/projects`** vs **`/projects/:id/board`**, then assert DOM roles in a real Chromium session.