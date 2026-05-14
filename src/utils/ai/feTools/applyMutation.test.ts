import { message } from "antd";
import { QueryClient } from "@tanstack/react-query";

import { applyMutationTool, ApplyMutationArgs } from "./applyMutation";
import type { FeToolContext } from "./types";

jest.mock("antd", () => {
    const actual = jest.requireActual("antd");
    return {
        ...actual,
        message: {
            ...actual.message,
            open: jest.fn(),
            destroy: jest.fn(),
            success: jest.fn(),
            error: jest.fn()
        }
    };
});

const buildCtx = (
    overrides: Partial<FeToolContext> & {
        apiRequest?: FeToolContext["apiRequest"];
    } = {}
): FeToolContext => ({
    queryClient: new QueryClient(),
    projectId: "p1",
    autonomyLevel: "plan",
    ...overrides
});

const baseArgs = (
    overrides: Partial<ApplyMutationArgs> = {}
): ApplyMutationArgs => ({
    proposal_id: "prop-1",
    stage: "apply",
    project_id: "p1",
    diff: {
        task_updates: [{ task_id: "t1", field: "storyPoints", from: 3, to: 5 }]
    },
    ...overrides
});

describe("applyMutationTool", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("short-circuits with {skipped: true} when stage is not 'apply'", async () => {
        const ctx = buildCtx({ apiRequest: jest.fn() });
        const result = await applyMutationTool.run(
            baseArgs({ stage: "approval" }),
            ctx
        );
        expect(result).toEqual({ skipped: true });
        expect(ctx.apiRequest).not.toHaveBeenCalled();
    });

    it("returns {error: 'api_unavailable'} when no apiRequest is wired", async () => {
        const ctx = buildCtx({ apiRequest: undefined });
        const result = await applyMutationTool.run(baseArgs(), ctx);
        expect(result).toEqual({ error: "api_unavailable" });
    });

    it("returns {error: 'missing_project_id'} when projectId is absent in args + ctx", async () => {
        const apiRequest = jest.fn();
        const ctx = buildCtx({ apiRequest, projectId: undefined });
        const result = await applyMutationTool.run(
            baseArgs({ project_id: undefined }),
            ctx
        );
        expect(result).toEqual({ error: "missing_project_id" });
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it("calls PUT /tasks per task_update then records server undo metadata", async () => {
        const apiRequest = jest.fn().mockResolvedValue({});
        const queryClient = new QueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        const ctx = buildCtx({ apiRequest, queryClient });

        const result = await applyMutationTool.run(
            baseArgs({
                diff: {
                    task_updates: [
                        { task_id: "t1", field: "storyPoints", from: 1, to: 2 },
                        {
                            task_id: "t2",
                            field: "columnId",
                            from: "c1",
                            to: "c2"
                        }
                    ]
                }
            }),
            ctx
        );

        // Two PUTs + one POST = three calls total.
        expect(apiRequest).toHaveBeenCalledTimes(3);
        expect(apiRequest).toHaveBeenNthCalledWith(1, "tasks", {
            method: "PUT",
            data: { _id: "t1", projectId: "p1", storyPoints: 2 }
        });
        expect(apiRequest).toHaveBeenNthCalledWith(2, "tasks", {
            method: "PUT",
            data: { _id: "t2", projectId: "p1", columnId: "c2" }
        });
        expect(apiRequest).toHaveBeenNthCalledWith(
            3,
            "agents/mutations/record",
            {
                method: "POST",
                data: expect.objectContaining({
                    proposal_id: "prop-1",
                    project_id: "p1",
                    undo: {
                        task_updates: [
                            {
                                task_id: "t1",
                                field: "storyPoints",
                                from: 1,
                                to: 2
                            },
                            {
                                task_id: "t2",
                                field: "columnId",
                                from: "c1",
                                to: "c2"
                            }
                        ]
                    }
                })
            }
        );
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: ["tasks", { projectId: "p1" }]
        });
        expect(message.open).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, applied: true });
    });

    it("prefers the args project_id over ctx.projectId", async () => {
        const apiRequest = jest.fn().mockResolvedValue({});
        const ctx = buildCtx({ apiRequest, projectId: "ctx-p" });
        await applyMutationTool.run(baseArgs({ project_id: "args-p" }), ctx);
        // First PUT carries the args-supplied projectId.
        expect(apiRequest.mock.calls[0][1].data.projectId).toBe("args-p");
    });

    it("works with an empty task_updates list (no PUTs, still records the proposal)", async () => {
        const apiRequest = jest.fn().mockResolvedValue({});
        const ctx = buildCtx({ apiRequest });
        await applyMutationTool.run(
            baseArgs({ diff: { task_updates: [] } }),
            ctx
        );
        // Only the record call should fire.
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest).toHaveBeenCalledWith(
            "agents/mutations/record",
            expect.objectContaining({ method: "POST" })
        );
    });
});
