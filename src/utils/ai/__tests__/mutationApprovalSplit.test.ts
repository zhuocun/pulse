import { QueryClient } from "@tanstack/react-query";

import { message } from "@/components/ui/toast";

import {
    applyApprovedMutationTool,
    type ApplyApprovedMutationArgs
} from "../feTools/applyApprovedMutation";
import {
    clearPendingApprovals,
    peekPendingApproval,
    requestMutationApprovalTool,
    type RequestMutationApprovalArgs
} from "../feTools/requestMutationApproval";
import type { FeToolContext } from "../feTools/types";

jest.mock("@/components/ui/toast", () => ({
    message: {
        open: jest.fn(),
        destroy: jest.fn(),
        success: jest.fn(),
        error: jest.fn()
    }
}));

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

const baseApprovalArgs = (
    overrides: Partial<RequestMutationApprovalArgs> = {}
): RequestMutationApprovalArgs => ({
    proposal_id: "prop-1",
    project_id: "p1",
    explanation: "Move t1 to Done",
    mutation: {
        task_updates: [
            { task_id: "t1", field: "columnId", from: "c1", to: "c2" }
        ]
    },
    ...overrides
});

const baseApplyArgs = (
    overrides: Partial<ApplyApprovedMutationArgs> = {}
): ApplyApprovedMutationArgs => ({
    approval_id: "approval-test-1",
    ...overrides
});

beforeEach(() => {
    clearPendingApprovals();
    jest.clearAllMocks();
});

describe("requestMutationApprovalTool", () => {
    it("registers a pending approval and returns {approval_id, status: 'pending'}", async () => {
        const ctx = buildCtx();
        const result = await requestMutationApprovalTool.run(
            baseApprovalArgs({ approval_id: "approval-A" }),
            ctx
        );
        expect(result).toEqual({
            approval_id: "approval-A",
            status: "pending",
            explanation: "Move t1 to Done"
        });
        expect(peekPendingApproval("approval-A")).toEqual({
            proposalId: "prop-1",
            projectId: "p1",
            diff: {
                task_updates: [
                    {
                        task_id: "t1",
                        field: "columnId",
                        from: "c1",
                        to: "c2"
                    }
                ]
            }
        });
    });

    it("generates an approval id when the caller omits one", async () => {
        const ctx = buildCtx();
        const result = await requestMutationApprovalTool.run(
            baseApprovalArgs({ approval_id: undefined }),
            ctx
        );
        expect(result.status).toBe("pending");
        expect(result.approval_id).toMatch(/^approval_prop-1_/);
        // Approval is durable across the call boundary.
        expect(peekPendingApproval(result.approval_id)).toBeTruthy();
    });

    it("returns status='rejected' when no proposal_id is supplied", async () => {
        const ctx = buildCtx();
        const result = await requestMutationApprovalTool.run(
            {
                // intentionally missing proposal_id
                explanation: "bad call"
            } as unknown as RequestMutationApprovalArgs,
            ctx
        );
        expect(result).toEqual({
            approval_id: "",
            status: "rejected",
            explanation: "missing_proposal_id"
        });
    });

    it("accepts `diff` as an alias for `mutation`", async () => {
        const ctx = buildCtx();
        const result = await requestMutationApprovalTool.run(
            {
                approval_id: "approval-B",
                proposal_id: "prop-2",
                project_id: "p1",
                diff: {
                    task_updates: [
                        {
                            task_id: "t2",
                            field: "storyPoints",
                            from: 3,
                            to: 5
                        }
                    ]
                }
            },
            ctx
        );
        expect(result.approval_id).toBe("approval-B");
        const pending = peekPendingApproval("approval-B");
        expect(pending?.diff.task_updates).toHaveLength(1);
        expect(pending?.diff.task_updates?.[0].field).toBe("storyPoints");
    });
});

describe("applyApprovedMutationTool", () => {
    it("hydrates from the pending approval and PUTs each task update", async () => {
        // Stage 1.
        requestMutationApprovalTool.run(
            baseApprovalArgs({ approval_id: "approval-pair-1" }),
            buildCtx()
        );
        // Stage 2.
        const apiRequest = jest.fn().mockResolvedValue({});
        const queryClient = new QueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        const ctx = buildCtx({ apiRequest, queryClient });

        const result = await applyApprovedMutationTool.run(
            baseApplyArgs({ approval_id: "approval-pair-1" }),
            ctx
        );

        expect(apiRequest).toHaveBeenCalledTimes(2); // 1 PUT + 1 record
        expect(apiRequest).toHaveBeenNthCalledWith(1, "tasks", {
            method: "PUT",
            data: { _id: "t1", projectId: "p1", columnId: "c2" }
        });
        expect(apiRequest).toHaveBeenNthCalledWith(
            2,
            "agents/mutations/record",
            {
                method: "POST",
                data: expect.objectContaining({
                    proposal_id: "prop-1",
                    project_id: "p1"
                })
            }
        );
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: ["tasks", { projectId: "p1" }]
        });
        expect(result).toEqual({
            status: "applied",
            details: {
                proposal_id: "prop-1",
                applied_count: 1,
                project_id: "p1"
            }
        });
        expect(message.open).toHaveBeenCalledTimes(1);
        // Approval is consumed (one-shot).
        expect(peekPendingApproval("approval-pair-1")).toBeUndefined();
    });

    it("returns status='failed' with error='unknown_approval_id' when approval_id is empty", async () => {
        const apiRequest = jest.fn();
        const ctx = buildCtx({ apiRequest });
        const result = await applyApprovedMutationTool.run(
            baseApplyArgs({ approval_id: "" }),
            ctx
        );
        expect(result).toEqual({
            status: "failed",
            details: { error: "unknown_approval_id" }
        });
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it("returns status='failed' with error='api_unavailable' without an apiRequest", async () => {
        requestMutationApprovalTool.run(
            baseApprovalArgs({ approval_id: "approval-noapi" }),
            buildCtx()
        );
        const ctx = buildCtx({ apiRequest: undefined });
        const result = await applyApprovedMutationTool.run(
            baseApplyArgs({ approval_id: "approval-noapi" }),
            ctx
        );
        expect(result).toEqual({
            status: "failed",
            details: { error: "api_unavailable" }
        });
    });

    it("returns status='failed' with error='missing_proposal_id' when no proposal is known", async () => {
        const ctx = buildCtx({ apiRequest: jest.fn() });
        const result = await applyApprovedMutationTool.run(
            // Approval id never registered; no proposal_id arg either.
            { approval_id: "never-registered" },
            ctx
        );
        expect(result).toEqual({
            status: "failed",
            details: { error: "missing_proposal_id" }
        });
    });

    it("returns status='failed' with error='missing_project_id' when neither approval nor ctx has one", async () => {
        // Register an approval without project_id.
        requestMutationApprovalTool.run(
            baseApprovalArgs({
                approval_id: "approval-nopid",
                project_id: undefined
            }),
            buildCtx({ projectId: undefined })
        );
        const ctx = buildCtx({
            apiRequest: jest.fn(),
            projectId: undefined
        });
        const result = await applyApprovedMutationTool.run(
            { approval_id: "approval-nopid" },
            ctx
        );
        expect(result).toEqual({
            status: "failed",
            details: { error: "missing_project_id" }
        });
    });

    it("returns status='failed' with error='exception' when the API throws", async () => {
        requestMutationApprovalTool.run(
            baseApprovalArgs({ approval_id: "approval-boom" }),
            buildCtx()
        );
        const apiRequest = jest.fn().mockRejectedValueOnce(new Error("nope"));
        const ctx = buildCtx({ apiRequest });
        const result = await applyApprovedMutationTool.run(
            { approval_id: "approval-boom" },
            ctx
        );
        expect(result.status).toBe("failed");
        if (result.status === "failed") {
            expect(result.details.error).toBe("exception");
            expect(result.details.message).toBe("nope");
        }
    });

    it("falls through to explicit args when no pending approval is registered", async () => {
        // No prior approval registration — the apply call carries the
        // diff/proposal_id/project_id explicitly (mirrors the route that
        // handles BE-issued ids).
        const apiRequest = jest.fn().mockResolvedValue({});
        const ctx = buildCtx({ apiRequest });
        const result = await applyApprovedMutationTool.run(
            {
                approval_id: "freshly-issued-by-be",
                proposal_id: "prop-explicit",
                project_id: "p1",
                diff: {
                    task_updates: [
                        {
                            task_id: "t9",
                            field: "storyPoints",
                            from: 2,
                            to: 3
                        }
                    ]
                }
            },
            ctx
        );
        expect(result.status).toBe("applied");
        expect(apiRequest).toHaveBeenCalledTimes(2);
    });
});
