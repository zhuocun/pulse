import useReactQuery from "./useReactQuery";

/**
 * Project-members data hook (M2 — backend task-richness feature).
 *
 * Powers the assignee picker in the task modal. Mirrors the thin
 * REST-resource convention of `useMembersList` / `useNotifications`: a
 * single exported endpoint string + matching per-project query key and a
 * `useReactQuery` read for the list. The endpoint string is the bare
 * resource path (`"projects/members"`, no `/api/v1/` prefix) — `useApi`
 * prepends `environment.apiBaseUrl` (`/api/v1`) so the same-origin
 * session cookie rides every request.
 *
 * NOTE on why this is NOT `useMembersList`: `useMembersList` hits
 * `GET /api/v1/users/members`, the GLOBAL user directory (every user in
 * the system), and is what the coordinator picker uses. The assignee
 * picker instead wants only the people on THIS project, which is a
 * different endpoint (`GET /api/v1/projects/members/?projectId=`) and a
 * different shape (`IProjectMember`, which adds `role`). They are kept as
 * separate hooks so each picker reads the right roster.
 *
 * The query is keyed per-project (`["projects/members", { projectId }]`)
 * and disabled until a `projectId` is known so the board doesn't fire a
 * `GET /projects/members/?projectId=undefined` while the route resolves.
 */
export const PROJECT_MEMBERS_ENDPOINT = "projects/members";

export const getProjectMembersQueryKey = (projectId: string | undefined) =>
    ["projects/members", { projectId }] as const;

/**
 * Project membership changes rarely relative to board churn, so we mirror
 * `useMembersList`'s 5-minute stale window: a recently-fetched roster
 * serves from cache without a background refetch on every modal open.
 */
export const PROJECT_MEMBERS_STALE_TIME_MS = 5 * 60 * 1000;

const useProjectMembers = (projectId: string | undefined) =>
    useReactQuery<IProjectMember[]>(
        PROJECT_MEMBERS_ENDPOINT,
        { projectId },
        undefined,
        undefined,
        undefined,
        Boolean(projectId),
        { staleTime: PROJECT_MEMBERS_STALE_TIME_MS }
    );

export default useProjectMembers;
