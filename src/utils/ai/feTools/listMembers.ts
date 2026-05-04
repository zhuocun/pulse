import type { FeTool } from "./types";

/**
 * `fe.listMembers` — read-only proxy to the cached members query
 * (`useReactQuery<IMember[]>("users/members")`). The agent may pass
 * `{ projectId }` to scope the list; for Phase A the cache is global so
 * we simply ignore the arg and return everything.
 */
export const listMembersTool: FeTool<
    { project_id?: string } | void,
    IMember[]
> = {
    name: "fe.listMembers",
    description: "List the members visible to the viewer.",
    run: (_args, ctx) => {
        const data = ctx.queryClient.getQueryData<IMember[]>(["users/members"]);
        return data ?? [];
    }
};
