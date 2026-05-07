import { semanticSearch } from "../engine";

import type { FeTool } from "./types";

/**
 * `fe.similarTasks` — reuses the v1 deterministic Jaccard ranker exposed
 * by `engine.semanticSearch`, then hydrates the resulting ids into the
 * `{id, text}` shape the agent's embedding/ranking nodes consume (see
 * `app/agents/catalog/task_estimation.py:fetch_embeddings`). The return
 * shape matches `fe_tool_schemas.py:fe.similarTasks` (`{similar: [...]}`).
 *
 * The agent passes a free-text `query` and (when available) a
 * `project_id`; older builds may pass `projectId` so both casings are
 * accepted to keep the contract resilient.
 */
export const similarTasksTool: FeTool<
    { query: string; project_id?: string; projectId?: string },
    { similar: Array<{ id: string; text: string }> }
> = {
    name: "fe.similarTasks",
    description:
        "Return tasks ranked by semantic similarity to a free-text query.",
    run: (args, ctx) => {
        const query = args?.query ?? "";
        const projectId = args?.project_id ?? args?.projectId ?? ctx.projectId;
        if (!projectId || !query.trim()) {
            return { similar: [] };
        }
        const tasks =
            ctx.queryClient.getQueryData<ITask[]>(["tasks", { projectId }]) ??
            [];
        const columns =
            ctx.queryClient.getQueryData<IColumn[]>([
                "boards",
                { projectId }
            ]) ?? [];
        const members =
            ctx.queryClient.getQueryData<IMember[]>(["users/members"]) ?? [];
        const projects =
            ctx.queryClient.getQueryData<IProject[]>(["projects"]) ?? [];
        const project = projects.find((p) => p._id === projectId) ?? {
            _id: projectId,
            projectName: "Project"
        };
        const ranked = semanticSearch("tasks", query, {
            project,
            tasks,
            columns,
            members
        });
        const taskById = new Map(tasks.map((t) => [t._id, t]));
        const similar = ranked.ids
            .map((id) => taskById.get(id))
            .filter((t): t is ITask => Boolean(t))
            .map((t) => ({
                id: t._id,
                text: `${t.taskName} ${t.note ?? ""}`.trim()
            }));
        return { similar };
    }
};
