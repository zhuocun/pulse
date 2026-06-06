import useReactQuery from "./useReactQuery";

/**
 * Project-milestones data hook (FE-MS-1 — backend Milestones feature).
 *
 * Mirrors the thin REST-resource convention used by `useLabels` /
 * `useMembersList` / `useNotifications`: a single exported endpoint
 * string + matching per-project query key and a `useReactQuery` read for
 * the list. The endpoint string is the bare resource path (`"milestones"`,
 * no `/api/v1/` prefix) exactly like `"labels"` and `"tasks"` — `useApi`
 * prepends `environment.apiBaseUrl` (`/api/v1`) so the same-origin session
 * cookie rides every request.
 *
 * Backend contract:
 *   - `GET /api/v1/milestones/?projectId=` → the project's `IMilestone[]`
 *     (`{ _id, projectId, name, description?, startDate?, dueDate?, state? }`).
 *   - `POST /api/v1/milestones/` body `{ projectId, name, description?,
 *     startDate?, dueDate?, state? }` → create.
 *   - `PUT /api/v1/milestones/` body `{ _id, name?, description?,
 *     startDate?, dueDate?, state? }` → update.
 *   - `DELETE /api/v1/milestones/?milestoneId=` → delete.
 *
 * The list query is keyed per-project (`["milestones", { projectId }]`) so
 * the milestone surface on one project never reads another project's
 * milestones, and a write invalidates exactly that project's list (the
 * `useReactMutation` default — see `useMilestoneMutations`). The query is
 * disabled until a `projectId` is known so the surface doesn't fire a
 * `GET /milestones/?projectId=undefined` while the route is still
 * resolving.
 */
export const MILESTONES_ENDPOINT = "milestones";

export const getMilestonesQueryKey = (projectId: string | undefined) =>
    ["milestones", { projectId }] as const;

/**
 * Milestones change rarely relative to how often the surface re-renders,
 * so we mirror `useLabels` / `useMembersList`'s 5-minute stale window: a
 * freshly-seeded / recently-fetched list serves from cache without a
 * background refetch on every mount.
 */
export const MILESTONES_STALE_TIME_MS = 5 * 60 * 1000;

const useMilestones = (projectId: string | undefined) => {
    const { data, ...rest } = useReactQuery<IMilestone[]>(
        MILESTONES_ENDPOINT,
        { projectId },
        undefined,
        undefined,
        undefined,
        Boolean(projectId),
        { staleTime: MILESTONES_STALE_TIME_MS }
    );

    /*
     * Normalize to a guaranteed `IMilestone[] | undefined`. The list
     * endpoint returns an array, but the query cache is shared with the
     * write mutations' key — a stray non-array payload (a write-endpoint
     * string ack, a malformed / errored response, or a test's global
     * fetch stub) must not crash the `.map` consumers in the manager. A
     * non-array resolves to `undefined` ("no data yet") rather than
     * throwing.
     */
    const milestones = Array.isArray(data) ? data : undefined;

    return { ...rest, data: milestones };
};

export default useMilestones;
