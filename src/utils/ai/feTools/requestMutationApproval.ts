import type { MutationDiff } from "../../../interfaces/agent";
import type { FeTool } from "./types";

/**
 * In-memory store of pending approvals, keyed by `approval_id`.
 *
 * The BE issues the `approval_id` string and the FE caches the pending
 * mutation payload here so the second tool call
 * (`fe.applyApprovedMutation`) can hydrate the diff and proposal id when
 * the agent resumes. The map is transient; a page reload clears it (the
 * BE refuses to apply unknown approval ids anyway).
 */
export interface PendingApproval {
    proposalId: string;
    projectId?: string;
    diff: MutationDiff;
}

const pendingApprovals = new Map<string, PendingApproval>();

/**
 * Look up a pending approval (consumes the entry, mirroring the one-shot
 * semantics the BE enforces).
 */
export const consumePendingApproval = (
    approvalId: string
): PendingApproval | undefined => {
    const entry = pendingApprovals.get(approvalId);
    if (entry) {
        pendingApprovals.delete(approvalId);
    }
    return entry;
};

/**
 * Inspect (without consuming) a pending approval. Used by tests / debug.
 */
export const peekPendingApproval = (
    approvalId: string
): PendingApproval | undefined => pendingApprovals.get(approvalId);

/** Test-only helper to clear the approval store between cases. */
export const clearPendingApprovals = (): void => {
    pendingApprovals.clear();
};

export type RequestMutationApprovalArgs = {
    /** Optional pre-allocated id; otherwise the FE makes one client-side. */
    approval_id?: string;
    /** Mutation proposal id (server-provided, links back to the proposal). */
    proposal_id: string;
    project_id?: string;
    /** The diff the user is being asked to approve. */
    mutation?: MutationDiff;
    diff?: MutationDiff;
    /** Optional human-readable explanation for the approval UI. */
    explanation?: string;
};

export type RequestMutationApprovalResult = {
    approval_id: string;
    status: "pending" | "rejected";
    explanation: string;
};

const generateApprovalId = (proposalId: string): string => {
    const suffix =
        typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `approval_${proposalId}_${suffix}`;
};

/**
 * Stage 1 of the mutation-approval handshake. The agent invokes this tool
 * to surface a proposed mutation; the FE persists it transiently and
 * pauses so the user can accept or reject the diff in the approval UI.
 *
 * Behaviour mirrors the legacy `fe.applyMutation` flow when called with
 * `stage: "approval"` — no API calls happen here, only registration of
 * the pending diff. The HITL pause is enforced by
 * `useAgentToolResolver.ts`, which never auto-resumes this tool.
 */
export const requestMutationApprovalTool: FeTool<
    RequestMutationApprovalArgs,
    RequestMutationApprovalResult
> = {
    name: "fe.requestMutationApproval",
    description:
        "Stage 1 of the two-step mutation flow: register a proposed diff with the FE so the user can review it. Returns {approval_id, status, explanation}.",
    run: (args) => {
        const proposalId = args.proposal_id;
        if (!proposalId) {
            return {
                approval_id: "",
                status: "rejected" as const,
                explanation: "missing_proposal_id"
            };
        }
        const diff = args.mutation ?? args.diff ?? { task_updates: [] };
        const approvalId = args.approval_id || generateApprovalId(proposalId);
        const explanation =
            typeof args.explanation === "string" && args.explanation.length > 0
                ? args.explanation
                : "Approve to apply this change to the board.";
        pendingApprovals.set(approvalId, {
            proposalId,
            projectId: args.project_id,
            diff
        });
        return {
            approval_id: approvalId,
            status: "pending" as const,
            explanation
        };
    }
};
