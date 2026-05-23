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
type CopilotDockTab = "chat" | "brief";

interface CopilotDockState {
    open: boolean;
    activeTab: CopilotDockTab;
    initialPrompt: string | null;
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
    copilotDock: { open: false, activeTab: "chat", initialPrompt: null }
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
         */
        openCopilotDock(
            state,
            action: PayloadAction<
                { tab?: CopilotDockTab; pendingPrompt?: string } | undefined
            >
        ) {
            const payload = action.payload;
            state.copilotDock.open = true;
            if (payload?.tab) {
                state.copilotDock.activeTab = payload.tab;
            }
            state.copilotDock.initialPrompt = payload?.pendingPrompt ?? null;
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
        }
    }
});

export const overlaysActions = overlaysSlice.actions;
export type { CopilotDockTab };
