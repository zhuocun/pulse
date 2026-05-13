import { useCallback } from "react";

import { overlaysActions } from "../../store/reducers/overlaysSlice";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Open/close + editing-id state for the task modal.
 *
 * Previously URL-driven (`?editingTaskId=…`) so the system back button
 * could dismiss the overlay. iOS Safari WebKit didn't propagate
 * React-Router context updates to the modal's subtree, so the click
 * wrote the URL but the modal never opened — see PR #226 for the same
 * migration applied to `useProjectModal`. The whole family is now on
 * Redux, dispatched synchronously, propagated via
 * `useSyncExternalStore` under `react-redux`.
 */
const useTaskModal = () => {
    const dispatch = useReduxDispatch();
    const editingTaskId = useReduxSelector((s) => s.overlays.editingTaskId);
    const closeModal = useCallback(() => {
        dispatch(overlaysActions.closeTaskModal());
    }, [dispatch]);
    const startEditing = useCallback(
        (id: string) => {
            dispatch(overlaysActions.startEditingTask(id));
        },
        [dispatch]
    );
    return {
        editingTaskId,
        closeModal,
        startEditing
    };
};

export default useTaskModal;
