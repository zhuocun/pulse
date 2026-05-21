import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Open/close state for every URL-independent overlay in the app — task
 * modal, AI chat drawer, board brief drawer, and AI task-draft modal.
 * See `utils/hooks/_createOverlayHook.ts` for the iOS Safari +
 * cross-subtree-propagation rationale that motivated migrating the
 * whole family off URL search params and onto Redux.
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
