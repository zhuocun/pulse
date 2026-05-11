<!-- orchestrate handoff
task: members-popover-avatars-cache
branch: orch/non-ga-todos-2f52/members-popover-avatars-cache
agentId: bc-8136847d-51c9-4bba-8974-ef3f65fb373b
runId: run-d16bb639-d220-4271-9a19-bb04c1e4838c
resultStatus: finished
finishedAt: 2026-05-10T12:53:17.975Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/members-popover-avatars-cache`

## What I did
- Added `src/utils/hooks/useMembersList.ts`:
  - wraps `useReactQuery<IMember[]>("users/members")`
  - exports shared endpoint/query key constants
  - applies shared `staleTime` (`5 * 60 * 1000`)
- Extended `useReactQuery` to accept an optional `staleTime` option so `useMembersList` can set cache freshness centrally.
- Migrated the scoped consumers to `useMembersList()`:
  - `src/components/memberPopover/index.tsx`
  - `src/pages/board.tsx`
  - `src/pages/project.tsx`
  - `src/components/taskModal/index.tsx`
- Updated `MembersPopover` trigger UI to render:
  - avatar group (preview of members)
  - count badge
  - preserved focusable button trigger and existing `aria-label`.
- Removed the unconditional open-time refetch behavior from `MembersPopover` (`onOpenChange` refetch path removed).
- Updated tests in `src/components/memberPopover/index.test.tsx` to cover:
  - avatar initials + count badge rendering in trigger
  - no refetch calls when opening the popover
- Updated `docs/todo/ui-todo.md`:
  - marked §14 complete for members popover avatars/count + cached behavior
  - marked §19 members-query duplication line complete for shared hook + cache.
- Ran required verification commands and pushed commits to the required branch.

## Measurements
- `scoped consumers using useMembersList(): 0 → 4`
- `scoped direct useReactQuery<IMember[]>("users/members") callsites: 3 → 0`
- `users/members requests after DevTools clear with repeated popover opens: 0 == 0`
- `CI=true npm test -- --watchAll=false: 1064 passing == 1064 passing`
- `npm run typecheck: exit 0 == exit 0`
- `npm run build: exit 0 == exit 0`
- `npm run eslint: exit 0 == exit 0`

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- UI/manual verification artifact recorded at:  
  `/opt/cursor/artifacts/members_popover_avatar_count_and_cached_open_behavior.mp4`
- Live verification showed the Members trigger displaying avatar group + count badge and repeated open/close produced no `users/members` requests after clearing Network logs.
- `npm run eslint` passes but still reports one pre-existing warning in `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`), outside this scoped task.
- `src/components/projectModal/index.tsx` still has a direct `useReactQuery<IMember[]>("users/members")` usage; it was not touched because it was outside the scoped modify paths.

## Suggested follow-ups
- If desired, migrate `src/components/projectModal/index.tsx` to `useMembersList()` as a separate scoped tranche to make members-query usage uniform across remaining surfaces.
- If backlog hygiene policy requires it for closed items, add a matching `docs/todo/product-done.md` row in the orchestrator merge tranche (not edited here due scoped file constraints).