import { useCallback } from "react";

import { overlaysActions } from "../../store/reducers/overlaysSlice";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Open/close state for the AI Chat drawer.
 *
 * Previously URL-driven (`?chat=1[:prompt]`); migrated to Redux for the
 * same reason as the rest of the overlay family — see `useTaskModal` /
 * `useProjectModal` for the iOS Safari WebKit symptom that drove the
 * change.
 */
const useAiChatDrawer = () => {
    const dispatch = useReduxDispatch();
    const open = useReduxSelector((s) => s.overlays.chatDrawer.open);
    const pendingPrompt = useReduxSelector(
        (s) => s.overlays.chatDrawer.pendingPrompt
    );
    const openDrawer = useCallback(
        (initialPrompt?: string) => {
            dispatch(
                overlaysActions.openChatDrawer(
                    initialPrompt ? { pendingPrompt: initialPrompt } : undefined
                )
            );
        },
        [dispatch]
    );
    const closeDrawer = useCallback(() => {
        dispatch(overlaysActions.closeChatDrawer());
    }, [dispatch]);
    return {
        open,
        openDrawer,
        closeDrawer,
        pendingPrompt: pendingPrompt ?? undefined
    };
};

export default useAiChatDrawer;
