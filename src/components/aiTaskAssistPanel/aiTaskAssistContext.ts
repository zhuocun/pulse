import type { AiContextProject } from "../../utils/ai/engine";
import type { RunPayload } from "../../utils/hooks/useAi";

export const TASK_ASSIST_DEBOUNCE_MS = 1000;
export const TASK_ASSIST_DELAYED_SPINNER_MS = 250;

export const buildLocalAiContext = (
    projectId: string | undefined,
    columns: IColumn[],
    tasks: ITask[],
    members: IMember[]
): AiContextProject => ({
    project: { _id: projectId ?? "", projectName: "" },
    columns,
    tasks,
    members
});

export const asMicrocopyString = (value: unknown): string =>
    typeof value === "string" ? value : String(value ?? "");

export interface LocalTaskDraftFields {
    taskName: string;
    note?: string;
    epic?: string;
    type?: string;
    coordinatorId?: string;
}

export const buildLocalEstimateRunPayload = (
    fields: LocalTaskDraftFields,
    options: {
        tasks: ITask[];
        excludeTaskId?: string;
        context: AiContextProject;
    }
): RunPayload => ({
    estimate: {
        taskName: fields.taskName,
        note: fields.note,
        epic: fields.epic,
        type: fields.type,
        tasks: options.tasks,
        excludeTaskId: options.excludeTaskId,
        context: options.context
    }
});

export const buildLocalReadinessRunPayload = (
    fields: LocalTaskDraftFields,
    context: AiContextProject
): RunPayload => ({
    readiness: {
        taskName: fields.taskName,
        note: fields.note,
        epic: fields.epic,
        type: fields.type,
        coordinatorId: fields.coordinatorId,
        context
    }
});

/**
 * `useAi.run` records failures on hook `error` before rejecting; absorb only
 * the stray promise rejection so estimate/readiness errors stay visible in UI.
 */
export const absorbUseAiRunRejection = (): void => undefined;
