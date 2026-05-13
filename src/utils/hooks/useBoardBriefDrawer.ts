import { useCallback } from "react";

import { overlaysActions } from "../../store/reducers/overlaysSlice";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Open/close state for the Board Brief drawer. Previously URL-driven
 * (`?brief=1`); migrated to Redux for cross-subtree propagation that
 * stays reliable on iOS Safari WebKit — see `useTaskModal` /
 * `useProjectModal` for the underlying symptom.
 */
const useBoardBriefDrawer = () => {
    const dispatch = useReduxDispatch();
    const open = useReduxSelector((s) => s.overlays.boardBriefOpen);
    const openDrawer = useCallback(() => {
        dispatch(overlaysActions.openBoardBrief());
    }, [dispatch]);
    const closeDrawer = useCallback(() => {
        dispatch(overlaysActions.closeBoardBrief());
    }, [dispatch]);
    return { open, openDrawer, closeDrawer };
};

export default useBoardBriefDrawer;
