import { gatherCachedList } from "../../hooks/useCachedQueryData";

import type { FeTool } from "./types";

interface GetProjectResult {
    project: IProject | null;
}

/**
 * `fe.getProject` — return one project by id from the cache. Scans every
 * `["projects", *]` parametric variant (the bare `["projects"]` key is
 * rarely populated in production: see review follow-up #2 and the keying
 * contract in `useReactQuery.ts`). Falls back to the single-project shape
 * if the only cached entry is `["projects", { projectId }]`.
 */
export const getProjectTool: FeTool<{ project_id: string }, GetProjectResult> =
    {
        name: "fe.getProject",
        description: "Return one project by id, or null if not in the cache.",
        run: (args, ctx) => {
            const projectId = args?.project_id ?? ctx.projectId;
            if (!projectId) return { project: null };
            const projects = gatherCachedList<IProject>(ctx.queryClient, [
                "projects"
            ]);
            const match = projects.find((p) => p._id === projectId);
            if (match) return { project: match };
            // Defensive fallback: try the exact single-project key shape used
            // by `pages/board.tsx` (`useReactQuery<IProject>("projects", {
            // project_id })`). gatherCachedList already covers this case for
            // typical entries, but a custom `specialQueryKey` could land
            // outside the `["projects", *]` prefix scan.
            const single = ctx.queryClient.getQueryData<IProject>([
                "projects",
                { projectId }
            ]);
            return { project: single ?? null };
        }
    };
