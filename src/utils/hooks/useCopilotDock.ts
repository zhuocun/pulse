import { useCallback } from "react";

import {
    overlaysActions,
    type CopilotDockTab
} from "../../store/reducers/overlaysSlice";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Persistent CopilotDock state (Phase 4 R-A M1). The dock mounts inside
 * `MainLayout` so it survives project-route navigations; this hook is
 * the canonical accessor for its open / activeTab / pendingPrompt
 * snapshot and the dispatch helpers that flip those keys.
 *
 * The legacy `useAiChatDrawer` / `useBoardBriefDrawer` hooks remain in
 * place because their dispatch callsites (CopilotMenu, palette
 * hand-off, welcome banner CTA, copilot-landing page) shouldn't have to
 * change with the dock-host migration. `CopilotDockHost` bridges those
 * flag flips onto the dock state via a sync effect so the legacy
 * triggers continue opening the dock on the right tab.
 *
 * Splits out helpers so callers can compose only what they need
 * without re-rendering on every dock state change:
 *   - `open` / `activeTab` / `pendingPrompt`: subscribe to state
 *   - `inboxUnreadCount`: ready-to-render unread count for the
 *     launcher badge. Owned by the host (see `setInboxUnread`); other
 *     callers should subscribe READ-ONLY.
 *   - `setInboxUnread(count)`: host-only — bumps `inboxUnreadCount`
 *     in sync with the triage agent's nudge buffer when the buffer
 *     grows past the host's high-water mark.
 *   - `openDock({ tab?, pendingPrompt? })`: opens (or refocuses) the
 *     dock on the supplied tab, threading any inline prompt through to
 *     the chat body
 *   - `closeDock()`: closes the dock and clears the pending prompt
 *   - `setActiveTab(tab)`: swap tabs without touching open/prompt
 *   - `clearInitialPrompt()`: clears the staged initial prompt
 *     without changing open/tab — used after ChatTabBody consumes the
 *     prompt so a subsequent tab switch back doesn't re-dispatch the
 *     same prompt
 *   - `markInboxRead()`: zeros the launcher badge unread count.
 *     Fired by the host on the Inbox open transition.
 */
const useCopilotDock = () => {
    const dispatch = useReduxDispatch();
    const state = useReduxSelector((s) => s.overlays.copilotDock);

    const openDock = useCallback(
        (payload?: { tab?: CopilotDockTab; pendingPrompt?: string }) => {
            dispatch(overlaysActions.openCopilotDock(payload));
        },
        [dispatch]
    );

    const closeDock = useCallback(() => {
        dispatch(overlaysActions.closeCopilotDock());
    }, [dispatch]);

    const setActiveTab = useCallback(
        (tab: CopilotDockTab) => {
            dispatch(overlaysActions.setCopilotDockTab(tab));
        },
        [dispatch]
    );

    const clearInitialPrompt = useCallback(() => {
        dispatch(overlaysActions.clearCopilotDockInitialPrompt());
    }, [dispatch]);

    const markInboxRead = useCallback(() => {
        dispatch(overlaysActions.markCopilotDockInboxRead());
    }, [dispatch]);

    const setInboxUnread = useCallback(
        (count: number) => {
            dispatch(overlaysActions.setCopilotDockInboxUnread(count));
        },
        [dispatch]
    );

    return {
        open: state.open,
        activeTab: state.activeTab,
        pendingPrompt: state.initialPrompt,
        inboxUnreadCount: state.inboxUnreadCount,
        openDock,
        closeDock,
        setActiveTab,
        clearInitialPrompt,
        markInboxRead,
        setInboxUnread
    };
};

export default useCopilotDock;
