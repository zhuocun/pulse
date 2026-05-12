<!-- orchestrate handoff
task: fix-hit-target-stacking
branch: orch/orch-btn-clicks-7894/fix-hit-target-stacking
agentId: bc-ddb16afb-74dd-4bc1-976f-193fe9e9fdbb
runId: run-66449b42-c285-439b-8da4-868cf61c2e43
resultStatus: finished
finishedAt: 2026-05-12T14:53:58.807Z
-->

## Status
success

## Branch
`orch/orch-btn-clicks-7894/fix-hit-target-stacking`

## What I did
- Read the bootstrap handoff at `.orchestrate/orch-btn-clicks-7894/handoffs/bootstrap-btn-clicks-ref.md` (the referenced `BUTTON-CLICK-AUDIT.md` is not in this workspace; applied the stated `ProjectCard` fix pattern: full-card `TitleLink::after` stays, controls elevated above it).
- Updated `src/components/projectCard/index.tsx`: `isolation: isolate` on the card; `Body` is `position: relative` so the stretched `::after` sizes to the padded surface; `TitleLink::after` uses `z-index: 1`; `MetaRow` `z-index: 2`; `ActionsCluster` `z-index: 3` with `isolation: isolate`; removed redundant per-button z-index inline styles.
- Added `src/components/projectCard.test.tsx` with `userEvent` tests for like, kebab → edit/delete, and primary title link `href` + click.
- Pushed branch and opened draft PR [#213](https://github.com/zhuocun/pulse/pull/213). Left `.orchestrate/**` unstaged/uncommitted.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/projectCard src/components/projectList src/components/projectPopover`: 15 passing → 16 passing
- `npx tsc --noEmit`: 0 errors → 0 errors
- `npm run eslint -- --max-warnings 0` on touched files: 0 warnings → 0 warnings

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- `.orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` was not found in-repo; implementation follows bootstrap handoff item (2) and existing `ProjectCard` comments.
- `HeaderRow` intentionally has **no** `position: relative` so the `TitleLink::after` containing block remains `Body` (full padded card), not the header strip only. `HeaderRow` still uses `z-index: 2` as a flex child for stacking order vs the overlay.
- `projectList` / `projectPopover` sources were unchanged after review; list behavior is entirely via `ProjectCard`.
- Screen recording saved at `/opt/cursor/artifacts/project-card-hit-target-stacking.mp4` (no manual board walkthrough loaded in that capture).

## Suggested follow-ups
- If clicks still flake in production, have a verifier reproduce on the real board with project cards inside DnD wrappers (`pathsForbidden` here) and compare with this slice.
- When adding interactive controls under `HeaderRow`, mirror the same stacking pattern called out in the bootstrap audit.