<!-- orchestrate handoff
task: bootstrap-btn-clicks-ref
branch: orch/orch-btn-clicks-7894/bootstrap-btn-clicks-ref
agentId: bc-0da91832-6b5b-4f1f-84b1-b188a7958f39
runId: run-b73ffd26-989c-416d-beb5-b63c795c6b68
resultStatus: finished
finishedAt: 2026-05-12T14:51:33.189Z
-->

## Status
success

## Branch
`orch/orch-btn-clicks-7894/bootstrap-btn-clicks-ref`

## What I did
- Read `AGENTS.md`, `src/pages/board.tsx` (`ColumnsViewport` / `pointer-events: none` fades), `src/components/projectCard/index.tsx`, and searched `src/` for DnD wrappers, `disableInteractiveElementBlocking`, pseudo-elements, `pointer-events`, `z-index`, and related patterns.
- Added `.orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` with executive summary, inventory table, full DnD matrix, stacking audit, cited snippets with line anchors, prioritized fix order, and embedded handoff notes.
- Committed and pushed; no edits under `src/**`, `backend/**`, `docs/**`, or package files.

## Measurements
- `git diff main --stat` paths outside `.orchestrate/orch-btn-clicks-7894/discovery/**`: == 0 files  
- `BUTTON-CLICK-AUDIT.md` line count: 179 lines added  
- `(none)` for further quantitative product metrics — audit-only worker  

## Verification
- `test -f .orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` → true  
- `not-verified` — documentation-only; no live UI repro or automated test for app behavior in this task  

## Notes, concerns, deviations, findings, thoughts, feedback
- Bootstrap file `.orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` was missing here; created fresh on this branch.
- No screen recording: no product/UI patch was made (audit deliverable only).
- **Top 3 fixes for implementers** (also in the audit): (1) require `disableInteractiveElementBlocking` on any new `Drag` whose subtree includes native interactive elements; (2) treat `ProjectCard` `TitleLink::after` as a full-card catcher — keep controls in `MetaRow`-style elevated stacks and extend the same if `HeaderRow` gains interactive children; (3) copy `ColumnsViewport` / auth hero `pointer-events: none` for any new decorative full-bleed layers.

## Suggested follow-ups
- Implementers: use section **6. Prioritized fix order** in `BUTTON-CLICK-AUDIT.md` and grep for new `<Drag>` usage during review.
- If symptoms remain after stacking/DnD checks, instrument repros around board horizontal `scroll-snap` + DnD and AntD drawer/modal mask stacking.