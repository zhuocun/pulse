import type { FeTool } from "./types";

interface ListBoardResult {
    columns: IColumn[];
}

/**
 * `fe.listBoard` — return the columns ("boards" in the API) for a given
 * project. Mirrors the query key used by `useDragEnd` and the board page:
 * `["boards", { projectId }]`.
 */
export const listBoardTool: FeTool<
    { project_id?: string } | void,
    ListBoardResult
> = {
    name: "fe.listBoard",
    description:
        "Return the columns (board) for a project, in their stored order.",
    run: (args, ctx) => {
        const projectId =
            (args && "project_id" in args ? args.project_id : undefined) ??
            ctx.projectId;
        if (!projectId) return { columns: [] };
        const data = ctx.queryClient.getQueryData<IColumn[]>([
            "boards",
            { projectId }
        ]);
        if (!data) return { columns: [] };
        return { columns: [...data].sort((a, b) => a.index - b.index) };
    }
};
