import type { CSSProperties } from "react";
import React from "react";

import { message } from "@/components/ui/toast";

import type { MutationDiff, TaskUpdate } from "../../../interfaces/agent";
import { ANALYTICS_EVENTS, track } from "../../../constants/analytics";
import { microcopy } from "../../../constants/microcopy";
import filterRequest from "../../filterRequest";
import type { FeTool } from "./types";
import { consumePendingApproval } from "./requestMutationApproval";

const buildUndoPayload = (taskUpdates: TaskUpdate[]): MutationDiff => ({
    task_updates: taskUpdates.map((u) => ({
        task_id: u.task_id,
        field: u.field,
        from: u.from,
        to: u.to
    }))
});

export type ApplyApprovedMutationArgs = {
    approval_id: string;
    /** Optional override (e.g. when the agent re-supplies context); the
     * cached pending approval still wins for the diff itself. */
    project_id?: string;
    /** Optional explicit proposal id — defaults to the cached value. */
    proposal_id?: string;
    /** Optional explicit diff — defaults to the cached value. */
    diff?: MutationDiff;
};

export type ApplyApprovedMutationResult =
    | {
          status: "applied";
          details: {
              proposal_id: string;
              applied_count: number;
              project_id: string;
          };
      }
    | {
          status: "failed";
          details: {
              error:
                  | "api_unavailable"
                  | "missing_project_id"
                  | "unknown_approval_id"
                  | "missing_proposal_id"
                  | "exception";
              message?: string;
          };
      };

/**
 * Stage 2 of the mutation-approval handshake. The agent invokes this tool
 * once the user accepts the pending diff registered by
 * `fe.requestMutationApproval`. It executes the mutation against the
 * authenticated REST API, records server-side undo metadata, and refreshes
 * the React Query cache.
 */
export const applyApprovedMutationTool: FeTool<
    ApplyApprovedMutationArgs,
    ApplyApprovedMutationResult
> = {
    name: "fe.applyApprovedMutation",
    description:
        "Stage 2 of the two-step mutation flow: execute the approved diff against the task APIs and record undo metadata. Returns {status, details}.",
    run: async (args, ctx) => {
        const approvalId = args.approval_id;
        if (!approvalId) {
            return {
                status: "failed" as const,
                details: { error: "unknown_approval_id" as const }
            };
        }
        const pending = consumePendingApproval(approvalId);
        const proposalId = args.proposal_id || pending?.proposalId || "";
        if (!proposalId) {
            return {
                status: "failed" as const,
                details: { error: "missing_proposal_id" as const }
            };
        }
        const projectId = (
            args.project_id ||
            pending?.projectId ||
            ctx.projectId ||
            ""
        ).trim();
        const api = ctx.apiRequest;
        if (!api) {
            return {
                status: "failed" as const,
                details: { error: "api_unavailable" as const }
            };
        }
        if (!projectId) {
            return {
                status: "failed" as const,
                details: { error: "missing_project_id" as const }
            };
        }
        const diff = args.diff ?? pending?.diff ?? { task_updates: [] };
        const taskUpdates = diff.task_updates ?? [];
        try {
            for (const u of taskUpdates) {
                const body: Record<string, unknown> = {
                    _id: u.task_id,
                    projectId,
                    [u.field]: u.to
                };
                await api("tasks", {
                    method: "PUT",
                    data: filterRequest(body)
                });
            }
            const undo = buildUndoPayload(taskUpdates);
            await api("agents/mutations/record", {
                method: "POST",
                data: filterRequest({
                    proposal_id: proposalId,
                    project_id: projectId,
                    undo
                })
            });
            await ctx.queryClient.invalidateQueries({
                queryKey: ["tasks", { projectId }]
            });
            const key = `copilot-mutation-${proposalId}`;
            const undoBtnStyle: CSSProperties = {
                background: "transparent",
                border: 0,
                color: "var(--pulse-brand-primary, #EA580C)",
                cursor: "pointer",
                font: "inherit",
                fontWeight: 500,
                marginInlineStart: 8,
                minHeight: 44,
                padding: "4px 8px",
                textDecoration: "underline"
            };
            message.open({
                type: "info",
                duration: 10,
                content: React.createElement(
                    "span",
                    null,
                    microcopy.mutation.applyToast,
                    " ",
                    React.createElement("button", {
                        type: "button",
                        style: undoBtnStyle,
                        onClick: async () => {
                            try {
                                track(ANALYTICS_EVENTS.AGENT_PROPOSAL_UNDONE, {
                                    id: proposalId,
                                    risk: "low"
                                });
                                await api("agents/mutations/undo", {
                                    method: "POST",
                                    data: filterRequest({
                                        proposal_id: proposalId,
                                        project_id: projectId
                                    })
                                });
                                await ctx.queryClient.invalidateQueries({
                                    queryKey: ["tasks", { projectId }]
                                });
                                message.destroy(key);
                                message.success(
                                    microcopy.mutation.undoApplied,
                                    1.5
                                );
                            } catch {
                                message.error(
                                    microcopy.feedback.operationFailed,
                                    2
                                );
                            }
                        },
                        children: microcopy.ai.undoLabel
                    })
                ),
                key
            });
            return {
                status: "applied" as const,
                details: {
                    proposal_id: proposalId,
                    applied_count: taskUpdates.length,
                    project_id: projectId
                }
            };
        } catch (err) {
            return {
                status: "failed" as const,
                details: {
                    error: "exception" as const,
                    message: err instanceof Error ? err.message : String(err)
                }
            };
        }
    }
};
