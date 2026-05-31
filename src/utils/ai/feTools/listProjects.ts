import { gatherCachedList } from "../../hooks/useCachedQueryData";

import type { FeTool } from "./types";

interface ListProjectsResult {
    projects: IProject[];
}

/**
 * `fe.listProjects` — read-only proxy to every cached project across all
 * parametric `["projects", *]` cache keys. `useReactQuery` keys the
 * projects query as `["projects", filterRequest({ projectName,
 * managerId })]` (see `pages/project.tsx`) and as `["projects", {
 * projectId }]` for single-project loads (see `pages/board.tsx`); the
 * bare `["projects"]` key is rarely populated. Scan-and-dedupe lets the
 * tool see whatever the user's screens have already loaded.
 */
export const listProjectsTool: FeTool<void, ListProjectsResult> = {
    name: "fe.listProjects",
    description:
        "List every project the viewer can see (from the local React Query cache).",
    run: (_args, ctx) => {
        return {
            projects: gatherCachedList<IProject>(ctx.queryClient, ["projects"])
        };
    }
};
