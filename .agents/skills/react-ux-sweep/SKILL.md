---
name: react-ux-sweep
description: Discover and fix UI/UX regressions in this react-app via headless-browser screenshots across routes, viewports, themes, and interaction states. Use when asked to audit the UI, review the design, find visual or accessibility regressions, screenshot the app, or "make the UI look right." Pairs each screenshot with a root-cause probe and a surgical fix; not for product/feature work or new pages.
---

# React UX Sweep

Find UI/UX issues by screenshot review and fix them in tight commits.
The screenshot matrix is the discovery loop — don't skip it because
"the change looks small."

## Loop

1. **Set up.** `npm install`. Playwright is **not** a project dependency
   and is not pre-installed — add it without touching the manifest
   (`npm i playwright --no-save`) and fetch a browser
   (`npx playwright install chromium`). Capture against a **production
   build** served by `vite preview`, not the dev server: `npm run build
   -- --mode development` (the `development` mode keeps `.env.development`
   so the local AI engine and feature flags stay on), then `npx vite
   preview --port 4173`. Dev-server route chunks lazy-compile on first
   hit and can hang in their Suspense state under headless automation.
   The remote API is blocked from this environment, so mock every
   endpoint inside Playwright.
2. **Read the references** before writing the script:
    - `references/playwright-harness.md` — mock contract, viewport
      matrix, traps, skeleton script. Use the recipe verbatim.
    - `references/issue-patterns.md` — review checklist plus the
      anti-patterns that look wrong but are correct.
3. **Capture** the matrix (routes × viewports × both themes ×
   interaction states).
4. **Review** every PNG against `issue-patterns.md`. List issues first;
   don't fix yet.
5. **Probe root cause** for every issue with a one-shot `page.evaluate`
   before editing. Code excerpts read by an explore agent will guess
   wrong on the traps in the references.
6. **Fix in themed batches**, one commit each. Re-screenshot after each
   batch and confirm the issue is gone.
7. **Quality gates** before commit: `npm run typecheck` clean,
   `npx jest <touched-paths>` green, full `npm test` green.

## Quality bar

Fix root causes, not symptoms. Examples in `issue-patterns.md`.

Do not add features, refactor architecture, introduce dependencies, or
write new tests unless an existing test breaks.
