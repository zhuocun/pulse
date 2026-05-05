import { useCallback } from "react";

import useUrl from "./useUrl";

export const TASK_MODAL_REOPEN_GUARD_MS = 400;

let lastClosedTaskId: string | null = null;
let lastClosedAtMs = 0;

const shouldBlockImmediateReopen = (taskId: string) => {
    if (
        lastClosedTaskId === taskId &&
        Date.now() - lastClosedAtMs < TASK_MODAL_REOPEN_GUARD_MS
    ) {
        return true;
    }
    if (Date.now() - lastClosedAtMs >= TASK_MODAL_REOPEN_GUARD_MS) {
        lastClosedTaskId = null;
        lastClosedAtMs = 0;
    }
    return false;
};

export const __resetTaskModalReopenGuardForTests = () => {
    lastClosedTaskId = null;
    lastClosedAtMs = 0;
};

const useTaskModal = () => {
    const [{ editingTaskId }, setEditingTaskId] = useUrl(["editingTaskId"]);
    const closeModal = useCallback(() => {
        lastClosedTaskId = editingTaskId ?? null;
        lastClosedAtMs = Date.now();
        setEditingTaskId({ editingTaskId: undefined });
    }, [editingTaskId, setEditingTaskId]);
    const startEditing = useCallback(
        (id: string) => {
            /*
             * The task cards behind the modal are real <button>s. On mobile,
             * the tap that dismisses the modal can leak through to the board
             * and immediately retrigger the same card, so the modal appears
             * "stuck" open. Ignore that same-task reopen for one short window
             * while still allowing an intentional switch to a different task.
             */
            if (shouldBlockImmediateReopen(id)) {
                return;
            }
            setEditingTaskId({ editingTaskId: id });
        },
        [setEditingTaskId]
    );
    return {
        editingTaskId,
        closeModal,
        startEditing
    };
};

export default useTaskModal;
