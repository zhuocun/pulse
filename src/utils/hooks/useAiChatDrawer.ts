import { useCallback } from "react";

import useUrl from "./useUrl";

/**
 * URL-driven open/close state for the AI Chat drawer so the system back
 * button (iOS swipe-back, Android hardware back) dismisses the drawer
 * instead of exiting the page entirely — the same pattern used by
 * `useBoardBriefDrawer`, `useTaskModal`, and `useAiDraftModal`.
 */
const useAiChatDrawer = () => {
    const [{ chat }, setUrl] = useUrl(["chat"]);
    const open = chat === "1";
    const openDrawer = useCallback(
        (initialPrompt?: string) => {
            setUrl({ chat: initialPrompt ? `1:${initialPrompt}` : "1" });
        },
        [setUrl]
    );
    const closeDrawer = useCallback(() => {
        setUrl({ chat: undefined });
    }, [setUrl]);
    const pendingPrompt =
        chat && chat.startsWith("1:") ? chat.slice(2) : undefined;
    return { open, openDrawer, closeDrawer, pendingPrompt };
};

export default useAiChatDrawer;
