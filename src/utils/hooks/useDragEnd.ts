import { DropResult } from "@hello-pangea/dnd";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { columnCallback, taskCallback } from "../optimisticUpdate/reorder";

import useActivityFeed from "./useActivityFeed";
import useReactMutation from "./useReactMutation";
import useReactQuery, { getReactQueryKey } from "./useReactQuery";

const useDragEnd = (options?: { tasksEnabled?: boolean }) => {
    const { projectId } = useParams<{ projectId: string }>();
    const tasksEnabled = options?.tasksEnabled ?? true;
    const queryClient = useQueryClient();
    const { data: boards } = useReactQuery<IColumn[]>("boards", {
        projectId
    });
    const { data: tasks } = useReactQuery<ITask[]>(
        "tasks",
        {
            projectId
        },
        undefined,
        undefined,
        undefined,
        tasksEnabled
    );
    const { record } = useActivityFeed();

    const { mutate: reorderColumn, isLoading: bLoading } = useReactMutation(
        "boards/orders",
        "PUT",
        ["boards", { projectId }],
        columnCallback
    );
    const { mutate: reorderTask, isLoading: rLoading } = useReactMutation(
        "tasks/orders",
        "PUT",
        ["tasks", { projectId }],
        taskCallback
    );
    const onDragEnd = useCallback(
        ({ source, destination, type }: DropResult) => {
            if (!destination) {
                return;
            }
            if (type === "COLUMN") {
                const fromColumn = boards?.[source.index];
                const referenceColumn = boards?.[destination.index];
                const fromId = fromColumn?._id;
                const referenceId = referenceColumn?._id;
                if (!fromId || !referenceId || fromId === referenceId) {
                    return;
                }
                const reorderType =
                    destination.index > source.index ? "after" : "before";
                reorderColumn({ fromId, referenceId, type: reorderType });
            }
            if (type === "ROW") {
                const tasksKey = getReactQueryKey("tasks", { projectId });
                const fullTasks =
                    tasks ??
                    (queryClient.getQueryData(tasksKey) as ITask[] | undefined);
                const fromColumnId = source.droppableId;
                const referenceColumnId = destination.droppableId;
                const fromColumnTasks = fullTasks?.filter(
                    (t) => t.columnId === fromColumnId
                );
                const referenceColumnTasks = fullTasks?.filter(
                    (t) => t.columnId === referenceColumnId
                );
                const fromTask = fromColumnTasks?.[source.index];
                const referenceTask = referenceColumnTasks?.[destination.index];
                if (!fromTask?._id) {
                    return;
                }
                if (fromTask?._id === referenceTask?._id) {
                    return;
                }
                reorderTask({
                    fromId: fromTask._id,
                    ...(referenceTask?._id
                        ? { referenceId: referenceTask._id }
                        : {}),
                    fromColumnId,
                    referenceColumnId,
                    type:
                        fromColumnId === referenceColumnId &&
                        destination.index > source.index
                            ? "after"
                            : "before"
                });
                /*
                 * Phase 4.3 follow-up — only cross-column moves are
                 * surfaced in the activity feed. Same-column reorders
                 * are visual-only on the board and would noise up the
                 * drawer without giving users a meaningful Undo. The
                 * undo closure re-runs `reorderTask` with the columns
                 * swapped (and no reference task) so the task lands
                 * back at the head of its original column — close
                 * enough to a true revert without snapshotting the
                 * exact source-index ordering.
                 */
                if (fromColumnId !== referenceColumnId) {
                    const fromColumnName =
                        boards?.find((b) => b._id === fromColumnId)
                            ?.columnName ?? fromColumnId;
                    const toColumnName =
                        boards?.find((b) => b._id === referenceColumnId)
                            ?.columnName ?? referenceColumnId;
                    const taskName = fromTask.taskName ?? "";
                    const summary = microcopyString(
                        microcopy.activityFeed.descriptions.taskMoved
                    )
                        .replace("{taskName}", taskName)
                        .replace("{fromColumn}", fromColumnName)
                        .replace("{toColumn}", toColumnName);
                    record({
                        kind: "task",
                        action: "move",
                        summary,
                        undo: () => {
                            reorderTask({
                                fromId: fromTask._id ?? "",
                                fromColumnId: referenceColumnId,
                                referenceColumnId: fromColumnId,
                                type: "before"
                            });
                        }
                    });
                }
            }
        },
        [
            boards,
            queryClient,
            projectId,
            record,
            reorderColumn,
            reorderTask,
            tasks
        ]
    );
    return {
        onDragEnd,
        isColumnDragDisabled: bLoading,
        isTaskDragDisabled: rLoading
    };
};

export default useDragEnd;
