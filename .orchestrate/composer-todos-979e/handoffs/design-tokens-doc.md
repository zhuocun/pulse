<!-- orchestrate handoff
task: design-tokens-doc
branch: orch/composer-todos-979e/design-tokens-doc
agentId: bc-4a19f371-dd2a-43c2-a7a8-7c76512c7adb
runId: run-f757f97f-2baf-4722-9e2a-96e25352f5fe
resultStatus: finished
finishedAt: 2026-05-10T10:17:36.368Z
-->

## Status
success

## Branch
`orch/composer-todos-979e/design-tokens-doc`

## What I did
- Tried to read `.orchestrate/composer-todos-979e/bootstrap-context.md`; it is **not present** in this workspace, so the doc is grounded in [`src/theme/tokens.ts`](src/theme/tokens.ts), [`src/theme/antdTheme.ts`](src/theme/antdTheme.ts), and [`src/theme/palettes/index.ts`](src/theme/palettes/index.ts).
- **Scales (concise):** **Space** — `space` ladder 4–64 px. **Palette** — hue-bearing `brand` / `accent` / `aurora` / `avatarGradients` from active `palette`; fixed neutrals/semantics in `glass`, `semantic`, `shadow`, `blur`, `tag`. **Typography** — `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fontFamily` (+ `breakpoints`). **Motion** — `motion` ms steps and `easing` curves (plus `radius`, `zIndex`, and layout helpers in the same module).
- **AntD mapping:** [`buildAntdTheme(mode, coarsePointer)`](src/theme/antdTheme.ts) sets global `token` (primary/semantic colors from `brand`/`semantic`, radii from `radius`, type scale from typography exports, motion durations from `motion`, touch-friendly `controlHeight*` when `coarsePointer`) and `components` overrides (Button, Modal, Table, etc.) using `space`, `radius`, `fontSize`, palette rgba, and mode.
- Added [`docs/design-tokens.md`](docs/design-tokens.md) with module links, contributor rules, a scales table, and AntD mapping section.
- Updated [`docs/status/ui-todo.md`](docs/status/ui-todo.md) (§1.2 summary, strikethrough §20e + complete note, §2.C bullet, suggested execution order §3 item 1) and [`docs/status/product-done.md`](docs/status/product-done.md) per AGENTS.md.
- Pushed branch; **draft PR:** https://github.com/zhuocun/pulse/pull/191 (base `main`). `.orchestrate/` was left unstaged and is **not** in the PR diff.

## Measurements
- `docs/design-tokens.md exists: false → true`
- `ui-todo §20e open: true → false`
- `§2.C design-tokens bullet "Missing" → "Reference shipped"`

## Verification
- `not-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- Orchestrator bootstrap path was missing locally; no substitute file was found via glob.
- This change is documentation + status only; no runtime or test execution was required for acceptance.

## Suggested follow-ups
- If the orchestrator relies on `bootstrap-context.md`, ensure that file is checked into the environment that runs workers or embed equivalent context elsewhere the workers can read.