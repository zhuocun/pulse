import type { FeTool } from "./types";

interface GetTaskResult {
    task: ITask | null;
}

/**
 * `fe.getTask` — return one task by id. Looks under both the project-scoped
 * cache (`["tasks", { projectId }]`) and falls back to scanning every cached
 * task list, so the agent can deep-link into a task even when the project
 * id is unknown.
 */
export const getTaskTool: FeTool<
    { task_id: string; project_id?: string },
    GetTaskResult
> = {
    name: "fe.getTask",
    description: "Return one task by id, or null if not in the cache.",
    run: (args, ctx) => {
        const projectId = args?.project_id ?? ctx.projectId;
        if (!args?.task_id) return { task: null };
        if (projectId) {
            const list =
                ctx.queryClient.getQueryData<ITask[]>([
                    "tasks",
                    { projectId }
                ]) ?? [];
            const hit = list.find((t) => t._id === args.task_id);
            if (hit) return { task: hit };
        }
        // Best-effort fallback — scan every cached `tasks*` query.
        const cache = ctx.queryClient.getQueryCache().getAll();
        for (const entry of cache) {
            const key = entry.queryKey;
            if (
                Array.isArray(key) &&
                typeof key[0] === "string" &&
                key[0].startsWith("tasks")
            ) {
                const list = entry.state.data as ITask[] | undefined;
                const hit = list?.find((t) => t._id === args.task_id);
                if (hit) return { task: hit };
            }
        }
        return { task: null };
    }
};
