import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Open/close state for every URL-independent overlay in the app — task
 * modal, AI chat drawer, board brief drawer, and AI task-draft modal.
 *
 * We used to derive each overlay's `open` flag from a URL search param
 * (`?editingTaskId`, `?chat`, `?brief`, `?aiDraft`) so the system back
 * button could dismiss the overlay and deep links worked. On iOS Safari
 * WebKit, React Router's context propagation didn't reach the modal
 * subtree after a `setSearchParams` write, so the click would update the
 * URL without ever flipping the modal — see `useProjectModal` for the
 * same migration applied first. Redux + `react-redux`'s
 * `useSyncExternalStore`-backed subscription is the most reliable
 * cross-subtree propagation primitive in React; switching to it makes
 * the open/close flips immediate and independent of the Router layer.
 */
interface ChatDrawerState {
    open: boolean;
    pendingPrompt: string | null;
}

interface OverlaysState {
    editingTaskId: string | null;
    chatDrawer: ChatDrawerState;
    boardBriefOpen: boolean;
    aiDraftActiveColumnId: string | null;
}

const initialState: OverlaysState = {
    editingTaskId: null,
    chatDrawer: { open: false, pendingPrompt: null },
    boardBriefOpen: false,
    aiDraftActiveColumnId: null
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
        }
    }
});

export const overlaysActions = overlaysSlice.actions;
