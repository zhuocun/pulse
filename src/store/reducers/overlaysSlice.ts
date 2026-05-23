import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Open/close state for every URL-independent overlay in the app — task
 * modal, AI chat drawer, board brief drawer, AI task-draft modal, and
 * the Phase 4 R-A M1 CopilotDock. See `utils/hooks/_createOverlayHook.ts`
 * for the iOS Safari + cross-subtree-propagation rationale that motivated
 * migrating the whole family off URL search params and onto Redux.
 */
interface ChatDrawerState {
    open: boolean;
    pendingPrompt: string | null;
}

/**
 * R-A M1: dock-level state for the persistent CopilotDock. Owns
 * open/closed + the active tab + the pending initial prompt so the
 * mount can survive project-route navigations. The dock currently lives
 * inside `MainLayout` (above the routed `<Outlet />`) so route changes
 * never tear it down, and it reads board / tasks / members from React
 * Query keyed by the URL `projectId` — see
 * `components/copilotDock/copilotDockHost.tsx`.
 *
 * The legacy `chatDrawer` + `boardBriefOpen` flags above stay live so
 * the existing trigger callsites (CopilotMenu in board.tsx, the welcome
 * banner CTA, the command-palette `boardCopilot:openChat` event, and
 * `pages/copilotLanding.tsx`'s `openChatDrawer()`) keep working
 * unchanged. The host bridges those flags onto the dock state via a
 * sync effect: an `openChatDrawer()` dispatch flips
 * `copilotDock.open = true` + `activeTab = "chat"`, mirroring the old
 * board-local `useEffect` collapse.
 */
type CopilotDockTab = "chat" | "brief" | "inbox";

interface CopilotDockState {
    open: boolean;
    activeTab: CopilotDockTab;
    initialPrompt: string | null;
    /**
     * Phase 4 A8 — wall-clock ms when the user last read the Inbox tab
     * (defined as: dock was open AND Inbox tab was the active surface).
     * The dock host derives `unreadCount = nudges.filter(n => n.receivedAt
     * > inboxLastReadAt).length` so the launcher badge is a pure function
     * of (incoming-nudge timestamps, last-read timestamp). Session-only
     * by design — the badge resets when the page reloads, matching the
     * triage-agent's session lifetime; a nudge that hasn't been triaged
     * since the last refresh is no longer a candidate for "unread".
     */
    inboxLastReadAt: number | null;
    /**
     * Phase 4 A8 — count of unread triage nudges the launcher badge
     * should advertise. Owned by `CopilotDockHost` (the only component
     * with access to the triage agent's nudges); recomputed and
     * dispatched whenever the agent's nudge buffer changes OR the
     * Inbox tab becomes the active surface (which drops the count to
     * 0 via `markCopilotDockInboxRead`). Launcher buttons subscribe
     * to this number directly — they don't touch the agent — so
     * adding a badge to a new launcher stays cheap.
     */
    inboxUnreadCount: number;
}

interface OverlaysState {
    editingTaskId: string | null;
    chatDrawer: ChatDrawerState;
    boardBriefOpen: boolean;
    aiDraftActiveColumnId: string | null;
    copilotDock: CopilotDockState;
}

const initialState: OverlaysState = {
    editingTaskId: null,
    chatDrawer: { open: false, pendingPrompt: null },
    boardBriefOpen: false,
    aiDraftActiveColumnId: null,
    copilotDock: {
        open: false,
        activeTab: "chat",
        initialPrompt: null,
        inboxLastReadAt: null,
        inboxUnreadCount: 0
    }
};

export const overlaysSlice = createSlice({
    name: "overlays",
    initialState,
    reducers: {
        startEditingTask(state, action: PayloadAction<string>) {
            state.editingTaskId = action.payload;
        },
        closeTaskModal(state) {
            state.editingTaskId = null;
        },
        openChatDrawer(
            state,
            action: PayloadAction<{ pendingPrompt?: string } | undefined>
        ) {
            state.chatDrawer.open = true;
            state.chatDrawer.pendingPrompt =
                action.payload?.pendingPrompt ?? null;
        },
        closeChatDrawer(state) {
            state.chatDrawer.open = false;
            state.chatDrawer.pendingPrompt = null;
        },
        openBoardBrief(state) {
            state.boardBriefOpen = true;
        },
        closeBoardBrief(state) {
            state.boardBriefOpen = false;
        },
        openAiDraft(state, action: PayloadAction<string>) {
            state.aiDraftActiveColumnId = action.payload;
        },
        closeAiDraft(state) {
            state.aiDraftActiveColumnId = null;
        },
        /**
         * Open the dock on the supplied tab (defaults to "chat"). When
         * a `pendingPrompt` is supplied, it lands in the dock state for
         * ChatTabBody to consume on the next render — this is the
         * command-palette → AI hand-off path.
         *
         * R-A M1 Issue #9 (MINOR): a payload-less `openCopilotDock()`
         * call previously cleared any already-staged prompt because
         * `payload?.pendingPrompt ?? null` ran unconditionally. The
         * intent documented elsewhere ("idempotent open") is that an
         * open dispatched with no payload should be a pure focus call
         * — it must not destroy state staged by a prior explicit open.
         * Only overwrite the prompt when the payload explicitly
         * supplies one (including `null` to clear).
         */
        openCopilotDock(
            state,
            action: PayloadAction<
                | {
                      tab?: CopilotDockTab;
                      pendingPrompt?: string | null;
                  }
                | undefined
            >
        ) {
            const payload = action.payload;
            state.copilotDock.open = true;
            if (payload?.tab) {
                state.copilotDock.activeTab = payload.tab;
            }
            if (payload && "pendingPrompt" in payload) {
                state.copilotDock.initialPrompt = payload.pendingPrompt ?? null;
            }
        },
        closeCopilotDock(state) {
            state.copilotDock.open = false;
            state.copilotDock.initialPrompt = null;
        },
        setCopilotDockTab(state, action: PayloadAction<CopilotDockTab>) {
            state.copilotDock.activeTab = action.payload;
        },
        clearCopilotDockInitialPrompt(state) {
            state.copilotDock.initialPrompt = null;
        },
        /**
         * Phase 4 A8 — stamps `inboxLastReadAt` with the current wall-
         * clock ms so the launcher badge's unread count drops to zero.
         * Fired by the dock host every time the Inbox tab becomes the
         * active surface (open dock + Inbox tab selected) — see
         * `CopilotDockHost`'s `useEffect` on (open, activeTab). Payload
         * is an explicit timestamp so tests can pin the value without
         * mocking `Date.now`.
         */
        markCopilotDockInboxRead(state, action: PayloadAction<number>) {
            state.copilotDock.inboxLastReadAt = action.payload;
            // Reading the inbox always zeros the unread count too —
            // there's no scenario where the user just opened the
            // inbox AND the badge should keep advertising unread.
            state.copilotDock.inboxUnreadCount = 0;
        },
        /**
         * Phase 4 A8 — projection updater for the launcher badge.
         * Dispatched by `CopilotDockHost` when the triage agent's
         * nudge buffer changes (and the user is NOT currently on the
         * Inbox tab — otherwise `markCopilotDockInboxRead` zeros it
         * out in the same render). The host is the only legitimate
         * caller; other components should subscribe READ-ONLY via
         * `useCopilotDock().inboxUnreadCount`.
         */
        setCopilotDockInboxUnread(state, action: PayloadAction<number>) {
            state.copilotDock.inboxUnreadCount = Math.max(0, action.payload);
        }
    }
});

export const overlaysActions = overlaysSlice.actions;
export type { CopilotDockTab };
