<!-- orchestrate handoff
task: verify-copilot-about
branch: orch/composer-todos-979e/verify-copilot-about
agentId: bc-5e6d1abd-1634-44e9-9ef7-22d7616ac108
runId: run-d8db4076-5ab9-4336-80a6-1f3be88902e3
resultStatus: finished
finishedAt: 2026-05-10T10:22:56.071Z
-->

I have enough evidence. Summary of my verification:

- **i18n keys in both locales:**
  - `en.ts` lines 736-757: `about.remoteModeTag`, `about.localModeTag`, `about.knowledgeCutoffTemplate`, `about.title`, `about.canHelpTitle`, `about.canHelpItems`, `about.limitationsTitle`, `about.limitationsItems`, plus the existing `a11y.aboutBoardCopilot` (line 79).
  - `zh-CN.ts` lines 694-716 mirror all of the above (`远程模型`, `本地引擎`, `知识截止时间：{date}`), plus `a11y.aboutBoardCopilot` (line 82, `关于看板 Copilot`).
  - `npx tsc --noEmit` passes, so the locale contract (`zh-CN` must structurally satisfy `enSource`) is enforced.
- **Knowledge-cutoff wiring is coherent:**
  - `src/constants/env.ts` lines 17-21, 108-111, 126-127: `REACT_APP_AI_KNOWLEDGE_CUTOFF` env var, `DEFAULT_AI_KNOWLEDGE_CUTOFF = "January 2026"`, exported on `environment.aiKnowledgeCutoff`.
  - `src/utils/ai/agentClient.ts` lines 260-266: `resolveAiKnowledgeCutoffForUi(metadata?)` prefers trimmed `metadata.knowledge_cutoff`, otherwise falls back to env.
  - `src/interfaces/agent.d.ts` line 22-23: optional `AgentMetadata.knowledge_cutoff` field documented.
  - `src/components/copilotAboutPopover/index.tsx` lines 42-45: `microcopy.about.knowledgeCutoffTemplate.replace("{date}", resolveAiKnowledgeCutoffForUi())` — no static one-off literal anymore.
- **a11y spot-check:** `index.tsx` line 133 sets `aria-label={microcopy.a11y.aboutBoardCopilot}`, present in both locales.
- **No raw English mode strings in JSX:** ripgrep over `src/components/copilotAboutPopover/` returns only `index.test.tsx` matches; `index.tsx` is clean (lines 110-112 read from `microcopy.about.remoteModeTag` / `localModeTag`).
- **Tests pass:**
  - `jest src/components/copilotAboutPopover/ src/utils/ai/agentClient.test.ts` → `Tests: 32 passed, 32 total`.
  - The popover suite includes a `setLocal(true)` case (lines 90-102) that asserts `Local engine` tag + description render — this is the offline / local-engine render-without-throw check (the popover itself does no network I/O, so its "offline" path is identical to local-engine).
  - The `agentClient.test.ts` adds 3 cases for `resolveAiKnowledgeCutoffForUi`: prefers wire, trims wire, falls back to env when wire absent or blank.
- **Docs/status updated:** `docs/status/ui-todo.md` line 3 + 123 strike §20c with the resolver source documented; `docs/status/product-done.md` line 58 has the matching one-liner.

I did not create any branches or commit anything (no useful verifier artifacts beyond logs already captured here).

## Verification
unit-test-verified

## Target
`copilot-about-popover` on branch `orch/composer-todos-979e/copilot-about-popover`

## Branch
(no branch)

## Execution
- `git status && git log --oneline -10` → clean tree on `orch/composer-todos-979e/copilot-about-popover`, latest commit `d885aad feat(ui): i18n CopilotAbout tags + config-driven knowledge cutoff`.
- `git show --stat d885aad` → diff touches `en.ts`, `zh-CN.ts`, `copilotAboutPopover/index.{tsx,test.tsx}`, `env.ts`, `agentClient.{ts,test.ts}`, `interfaces/agent.d.ts`, plus `docs/status/{ui-todo,product-done}.md`.
- Read `src/components/copilotAboutPopover/index.tsx` → confirmed `microcopy.about.{remoteModeTag,localModeTag,knowledgeCutoffTemplate,…}` + `microcopy.a11y.aboutBoardCopilot` only; no raw English mode literals.
- Read `src/i18n/locales/en.ts` (lines 736-757, 79) and `src/i18n/locales/zh-CN.ts` (lines 82, 694-716) → all required keys present in both locales with translated copy.
- Read `src/constants/env.ts` (header docs + lines 108-127) → `REACT_APP_AI_KNOWLEDGE_CUTOFF` documented, default `"January 2026"`, exported as `environment.aiKnowledgeCutoff`.
- Read `src/utils/ai/agentClient.ts` lines 255-266 → `resolveAiKnowledgeCutoffForUi` precedence: trimmed wire metadata first, env fallback second.
- Read `src/interfaces/agent.d.ts` lines 14-24 → `AgentMetadata.knowledge_cutoff?: string` exists.
- Read `src/components/copilotAboutPopover/index.test.tsx` → covers both `setLocal(true)` (local-engine) and `setLocal(false)` (remote) render paths plus knowledge-cutoff line and a11y `aria-label`.
- Read `src/utils/ai/agentClient.test.ts` lines 498-521 → `resolveAiKnowledgeCutoffForUi` describe block: prefers wire / trims wire / falls back to env.
- `rg '"Remote model"|"Local engine"' src/components/copilotAboutPopover` → only `index.test.tsx` matches; `index.tsx` clean.
- `npx tsc --noEmit` → pass (enforces zh-CN structural conformance to `enSource`).
- `npx jest src/components/copilotAboutPopover/ src/utils/ai/agentClient.test.ts --no-coverage` → `Test Suites: 2 passed, 2 total / Tests: 32 passed, 32 total`.
- `npx jest src/components/copilotAboutPopover --no-coverage` (re-run) → `Tests: 6 passed, 6 total` (includes local-engine offline-render case).
- `grep "20c" docs/status/ui-todo.md` and `grep "CopilotAboutPopover" docs/status/product-done.md` → §20c struck in `ui-todo.md` (lines 3, 123) and a one-liner added to `product-done.md` line 58.

## Findings
Per acceptance criterion:
- [x] No raw English mode strings in JSX for Remote/Local labels: **met** — `index.tsx` uses `microcopy.about.{remoteModeTag,localModeTag}`; ripgrep confirms no raw literals in source.
- [x] Knowledge cutoff not a stale one-off string without a single documented source: **met** — sourced via `resolveAiKnowledgeCutoffForUi` (wire `AgentMetadata.knowledge_cutoff` first, then `environment.aiKnowledgeCutoff` from `REACT_APP_AI_KNOWLEDGE_CUTOFF`), documented in `src/constants/env.ts` header.
- [x] Tests pass: **met** — 32/32 passing across `copilotAboutPopover` + `agentClient`; full `tsc --noEmit` clean.

Verifier-specific:
- [x] Both locales define new keys: **met** — `en.ts` and `zh-CN.ts` both define `about.remoteModeTag`, `about.localModeTag`, `about.knowledgeCutoffTemplate`, plus the existing `a11y.aboutBoardCopilot`. TypeScript dictionary contract enforces structural equivalence.
- [x] Popover still renders without throwing when offline/local engine: **met** — `index.test.tsx` "shows local engine info and tag when using the local engine" exercises `setLocal(true)` and asserts both tag + description render. The component performs no network I/O (purely reads `environment.aiUseLocalEngine` and a static template string), so "offline" is structurally identical to the local-engine path that already passes.

Other findings (severity-ordered):
- (low) The implementation does not yet pass live `AgentMetadata` into `resolveAiKnowledgeCutoffForUi` from the popover — it's called with no args, so only the env path is exercised in the running app. The wire override is wired in the resolver and unit-tested but not yet consumed in `index.tsx`. Acceptable: backend `AgentMetadata.as_dict()` does not emit `knowledge_cutoff` yet (called out in upstream handoff). When the BE adds it, FE just needs to plumb metadata into the call.
- (low) No live-browser screenshot/recording was captured. The change is copy/config wiring; the JSDOM tests already render both engine modes and verify the rendered DOM strings, which is the same surface a user would see. Live UI testing would not add information.

## Notes & suggestions
- All five acceptance criteria (3 target + 2 verifier-specific) verified by reading the source, running `tsc --noEmit`, and running the targeted Jest suites end-to-end on this branch. The branch is already pushed; no verifier-side commits were needed (no scripts or notes worth persisting beyond this handoff).
- Suggestion (matches upstream's own follow-up): once `backend/app/.../agents.py` includes `knowledge_cutoff` in `AgentMetadata.as_dict()`, plumb the agent metadata into `CopilotAboutPopover` so the resolver actually consumes its wire branch. The FE side (typing, resolver, fallback) is ready.