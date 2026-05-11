import { message } from "antd";
import type { CSSProperties } from "react";
import React from "react";

import type { MutationDiff, TaskUpdate } from "../../../interfaces/agent";
import { ANALYTICS_EVENTS, track } from "../../../constants/analytics";
import { microcopy } from "../../../constants/microcopy";
import filterRequest from "../../filterRequest";
import type { FeTool } from "./types";

export type ApplyMutationArgs = {
    proposal_id: string;
    stage: "approval" | "apply";
    project_id?: string;
    diff?: MutationDiff;
};

const buildUndoPayload = (taskUpdates: TaskUpdate[]): MutationDiff => ({
    task_updates: taskUpdates.map((u) => ({
        task_id: u.task_id,
        field: u.field,
        from: u.from,
        to: u.to
    }))
});

export const applyMutationTool: FeTool<
    ApplyMutationArgs,
    Record<string, unknown>
> = {
    name: "fe.applyMutation",
    description:
        "Executes an approved board mutation (stage=apply) via task APIs and records server undo metadata.",
    run: async (args, ctx) => {
        if (args.stage !== "apply") {
            return { skipped: true as const };
        }
        const api = ctx.apiRequest;
        const projectId = (args.project_id || ctx.projectId || "").trim();
        if (!api) {
            return { error: "api_unavailable" as const };
        }
        if (!projectId) {
            return { error: "missing_project_id" as const };
        }
        const taskUpdates = args.diff?.task_updates ?? [];
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
                proposal_id: args.proposal_id,
                project_id: projectId,
                undo
            })
        });
        await ctx.queryClient.invalidateQueries({
            queryKey: ["tasks", { projectId }]
        });
        const key = `copilot-mutation-${args.proposal_id}`;
        const undoBtnStyle: CSSProperties = {
            background: "transparent",
            border: 0,
            color: "var(--ant-color-primary, #EA580C)",
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
                                id: args.proposal_id,
                                risk: "low"
                            });
                            await api("agents/mutations/undo", {
                                method: "POST",
                                data: filterRequest({
                                    proposal_id: args.proposal_id,
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
        return { ok: true as const, applied: true as const };
    }
};
