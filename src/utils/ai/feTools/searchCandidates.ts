import type { FeTool } from "./types";

type SearchCandidatesArgs = {
    kind: "tasks" | "projects";
    query: string;
    project_id?: string;
    projectId?: string;
};

type SearchCandidate = { id: string; text: string };

/**
 * `fe.searchCandidates` — return raw candidate items from the React Query
 * cache so the search-agent can rank them server-side. Bounded at 50
 * entries to keep the agent prompt within reasonable token limits.
 *
 * Accepts both snake_case (`project_id`, the v2.1 BE convention
 * post-a59539f) and camelCase (`projectId`, legacy) for resilience.
 */
export const searchCandidatesTool: FeTool<
    SearchCandidatesArgs,
    { candidates: SearchCandidate[] }
> = {
    name: "fe.searchCandidates",
    description: "Return candidate items to be ranked by the search agent.",
    run: (args, ctx) => {
        if (!args) return { candidates: [] };

        if (args.kind === "tasks") {
            const projectId =
                args.project_id ?? args.projectId ?? ctx.projectId;
            if (!projectId) return { candidates: [] };
            const tasks =
                ctx.queryClient.getQueryData<ITask[]>([
                    "tasks",
                    { projectId }
                ]) ?? [];
            const candidates = tasks.slice(0, 50).map((t) => ({
                id: t._id,
                text: `${t.taskName} ${t.note ?? ""}`
            }));
            return { candidates };
        }

        const projects =
            ctx.queryClient.getQueryData<IProject[]>(["projects"]) ?? [];
        const candidates = projects
            .slice(0, 50)
            .map((p) => ({ id: p._id, text: p.projectName }));
        return { candidates };
    }
};
