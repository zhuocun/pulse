import { overlaysActions } from "../../store/reducers/overlaysSlice";

import createOverlayHook from "./_createOverlayHook";

/**
 * Open/close state for the AI Chat drawer. See `_createOverlayHook`
 * for the iOS Safari + cross-subtree-propagation rationale shared by
 * the whole overlay family.
 */
interface ChatDrawerSnapshot {
    open: boolean;
    pendingPrompt: string | null;
}

const useAiChatDrawerBase = createOverlayHook<ChatDrawerSnapshot, string>({
    select: (s) => s.overlays.chatDrawer,
    openAction: (initialPrompt) =>
        overlaysActions.openChatDrawer(
            initialPrompt ? { pendingPrompt: initialPrompt } : undefined
        ),
    closeAction: overlaysActions.closeChatDrawer
});

const useAiChatDrawer = () => {
    const { value, open, close } = useAiChatDrawerBase();
    return {
        open: value.open,
        pendingPrompt: value.pendingPrompt ?? undefined,
        openDrawer: open as (initialPrompt?: string) => void,
        closeDrawer: close
    };
};

export default useAiChatDrawer;
