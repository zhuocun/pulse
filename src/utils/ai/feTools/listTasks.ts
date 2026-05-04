import type { FeTool } from "./types";

/**
 * `fe.listTasks` — return the tasks for a given project from the cache.
 * Mirrors the query key used by `useDragEnd`: `["tasks", { projectId }]`.
 * Returns an empty array if the project cache is not yet populated.
 */
export const listTasksTool: FeTool<{ project_id?: string } | void, ITask[]> = {
    name: "fe.listTasks",
    description: "Return all tasks for a project, in stored order.",
    run: (args, ctx) => {
        const projectId =
            (args && "project_id" in args ? args.project_id : undefined) ??
            ctx.projectId;
        if (!projectId) return [];
        const data = ctx.queryClient.getQueryData<ITask[]>([
            "tasks",
            { projectId }
        ]);
        return data ?? [];
    }
};
