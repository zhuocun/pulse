import { useCallback } from "react";

import { overlaysActions } from "../../store/reducers/overlaysSlice";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Open/close + active-column-id state for the AI Task Draft modal.
 *
 * Previously URL-driven (`?aiDraft=<columnId>`); migrated to Redux so
 * the click flips the modal in the same render regardless of how React
 * Router's context propagates — see `useTaskModal` / `useProjectModal`
 * for the iOS Safari WebKit symptom. Multiple per-column triggers still
 * coexist: each `TaskCreator` only renders the modal when
 * `activeColumnId === its columnId`.
 */
const useAiDraftModal = () => {
    const dispatch = useReduxDispatch();
    const activeColumnId = useReduxSelector(
        (s) => s.overlays.aiDraftActiveColumnId
    );
    const openModal = useCallback(
        (columnId: string) => {
            dispatch(overlaysActions.openAiDraft(columnId));
        },
        [dispatch]
    );
    const closeModal = useCallback(() => {
        dispatch(overlaysActions.closeAiDraft());
    }, [dispatch]);
    return {
        activeColumnId: activeColumnId ?? undefined,
        openModal,
        closeModal
    };
};

export default useAiDraftModal;
