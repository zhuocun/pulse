import type { MutationDiff } from "../../../interfaces/agent";
import type { FeTool } from "./types";
import { applyApprovedMutationTool } from "./applyApprovedMutation";
import { requestMutationApprovalTool } from "./requestMutationApproval";

/**
 * @deprecated Use `fe.requestMutationApproval` / `fe.applyApprovedMutation`
 * for new agent code paths. This compatibility shim is preserved for
 * (a) older agent prompts that still emit `fe.applyMutation` and
 * (b) the existing FE call sites and test fixtures that pre-date the
 * BE split (see PRD §5.5).
 *
 * The shim dispatches by the `stage` field:
 *   - `stage: "approval"` → registers the pending mutation via
 *     `fe.requestMutationApproval` and returns `{skipped: true}` so the
 *     HITL pause in `useAgentToolResolver` still fires.
 *   - `stage: "apply"`    → consumes the cached approval (synthesising
 *     a one-shot approval id derived from the proposal id) and forwards
 *     to `fe.applyApprovedMutation`.
 */
export type ApplyMutationArgs = {
    proposal_id: string;
    stage: "approval" | "apply";
    project_id?: string;
    diff?: MutationDiff;
};

const SHIM_APPROVAL_PREFIX = "shim::";

const shimApprovalId = (proposalId: string): string =>
    `${SHIM_APPROVAL_PREFIX}${proposalId}`;

export const applyMutationTool: FeTool<
    ApplyMutationArgs,
    Record<string, unknown>
> = {
    name: "fe.applyMutation",
    description:
        "Deprecated two-stage shim. Use fe.requestMutationApproval and fe.applyApprovedMutation instead.",
    run: async (args, ctx) => {
        if (args.stage === "approval") {
            // Register the pending diff via the new tool so the apply
            // stage can hydrate from the same store.
            requestMutationApprovalTool.run(
                {
                    approval_id: shimApprovalId(args.proposal_id),
                    proposal_id: args.proposal_id,
                    project_id: args.project_id,
                    diff: args.diff
                },
                ctx
            );
            // Preserve the legacy return shape — the resolver treats this
            // tool's "approval" stage as a HITL pause and the response is
            // discarded.
            return { skipped: true as const };
        }
        const result = await applyApprovedMutationTool.run(
            {
                approval_id: shimApprovalId(args.proposal_id),
                proposal_id: args.proposal_id,
                project_id: args.project_id,
                diff: args.diff
            },
            ctx
        );
        if (result.status === "applied") {
            return { ok: true as const, applied: true as const };
        }
        // Map the new failure envelope back to the legacy `{error: code}`
        // shape so the existing call sites keep working.
        return { error: result.details.error };
    }
};
