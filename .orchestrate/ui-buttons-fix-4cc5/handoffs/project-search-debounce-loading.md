<!-- orchestrate handoff
task: project-search-debounce-loading
branch: orch/ui-buttons-fix-4cc5/project-search-debounce-loading
agentId: bc-0be60bf9-e54c-4141-83a2-6e3764fff2a3
runId: run-4b9d4160-272c-4b11-a158-0d04bf47af3d
resultStatus: finished
finishedAt: 2026-05-12T14:45:32.429Z
-->

## Status
success

## Branch
`orch/ui-buttons-fix-4cc5/project-search-debounce-loading`

## What I did
- **ProjectSearchPanel**: Local `draftProjectName` drives the input immediately; `setParam({ projectName })` runs after **300ms** (within 200–400ms). Cleared debounce timers on unmount, URL-driven `param.projectName` sync, chip dismiss, and clear-all. **Loading**: search `Input` is `disabled` with a **suffix `Spin`**, manager **`Select`** is `disabled` (+ existing `loading`); `aiSearchSlot` unchanged so **semantic `/ AI` wiring stays intact**.
- **Project page**: Removed **`useDebounce(param, 300)`** so `projectName` is not debounced twice; **`fetchParam`** now uses live **`param.projectName`** / **`param.managerId`** once the panel commits the name.
- **Tests**: **`index.test.tsx`** (fake timers: debounce, stale commit after dismiss chip, loading UI) and **`project.test.tsx`** (URL + fetch wait until debounce; search disabled while members fetch is pending).

## Measurements
- Debounced project search vs parent query thrash: **per-keystroke `setParam` / refetch** → **debounced commits** (verified via panel + page timer tests)
- Loading guards on name + manager filters while `loading`: **absent** → **disabled + search suffix `Spin`**
- Timing behaviour covered in tests: **no panel debounce tests** → **2 debounce/stale timer tests + updated page debounce test**
- `CI=true npm test … projectSearchPanel project.test.tsx`: **`11` passed** `==` **`11` passed`

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- **`docs/**` was not edited** (disallowed); backlog §9 was not updated in-repo.
- **`useDebounce.ts` unchanged** — debounce is implemented in the panel; page-level debounce was removed to avoid stacking delay.
- **Screen recording** (session artifact): `/opt/cursor/artifacts/project-search-panel-debounce-loading.mp4` (no live browser run of the app beyond automated tests).
- **Draft PR**: https://github.com/zhuocun/pulse/pull/212 (base `main`).

## Suggested follow-ups
- If product wants **URL/search chips to update while typing**, that would require showing draft state in chips or a “pending” affordance (not in this scope).