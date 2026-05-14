import { overlaysActions, overlaysSlice } from "./overlaysSlice";

const initialState = overlaysSlice.getInitialState();

describe("overlaysSlice", () => {
    it("seeds the initial state with all overlays closed", () => {
        expect(overlaysSlice.reducer(undefined, { type: "@@INIT" })).toEqual(
            initialState
        );
        expect(initialState).toEqual({
            editingTaskId: null,
            chatDrawer: { open: false, pendingPrompt: null },
            boardBriefOpen: false,
            aiDraftActiveColumnId: null
        });
    });

    it("startEditingTask sets editingTaskId", () => {
        const next = overlaysSlice.reducer(
            initialState,
            overlaysActions.startEditingTask("t-42")
        );
        expect(next.editingTaskId).toBe("t-42");
    });

    it("closeTaskModal clears editingTaskId", () => {
        const opened = overlaysSlice.reducer(
            initialState,
            overlaysActions.startEditingTask("t-42")
        );
        const closed = overlaysSlice.reducer(
            opened,
            overlaysActions.closeTaskModal()
        );
        expect(closed.editingTaskId).toBeNull();
    });

    it("openChatDrawer with no payload opens the drawer without a prompt", () => {
        const next = overlaysSlice.reducer(
            initialState,
            overlaysActions.openChatDrawer()
        );
        expect(next.chatDrawer).toEqual({ open: true, pendingPrompt: null });
    });

    it("openChatDrawer with pendingPrompt stores the prompt", () => {
        const next = overlaysSlice.reducer(
            initialState,
            overlaysActions.openChatDrawer({ pendingPrompt: "Summarize" })
        );
        expect(next.chatDrawer).toEqual({
            open: true,
            pendingPrompt: "Summarize"
        });
    });

    it("closeChatDrawer clears the pendingPrompt", () => {
        const opened = overlaysSlice.reducer(
            initialState,
            overlaysActions.openChatDrawer({ pendingPrompt: "hello" })
        );
        const closed = overlaysSlice.reducer(
            opened,
            overlaysActions.closeChatDrawer()
        );
        expect(closed.chatDrawer).toEqual({ open: false, pendingPrompt: null });
    });

    it("openBoardBrief / closeBoardBrief flip the boardBriefOpen flag", () => {
        const opened = overlaysSlice.reducer(
            initialState,
            overlaysActions.openBoardBrief()
        );
        expect(opened.boardBriefOpen).toBe(true);
        const closed = overlaysSlice.reducer(
            opened,
            overlaysActions.closeBoardBrief()
        );
        expect(closed.boardBriefOpen).toBe(false);
    });

    it("openAiDraft sets aiDraftActiveColumnId; closeAiDraft clears it", () => {
        const opened = overlaysSlice.reducer(
            initialState,
            overlaysActions.openAiDraft("col-7")
        );
        expect(opened.aiDraftActiveColumnId).toBe("col-7");
        const closed = overlaysSlice.reducer(
            opened,
            overlaysActions.closeAiDraft()
        );
        expect(closed.aiDraftActiveColumnId).toBeNull();
    });

    it("each overlay action only mutates its own slice key", () => {
        const populated = {
            editingTaskId: "t-1",
            chatDrawer: { open: true, pendingPrompt: "hi" },
            boardBriefOpen: true,
            aiDraftActiveColumnId: "c-1"
        };
        const next = overlaysSlice.reducer(
            populated,
            overlaysActions.closeChatDrawer()
        );
        expect(next.editingTaskId).toBe("t-1");
        expect(next.boardBriefOpen).toBe(true);
        expect(next.aiDraftActiveColumnId).toBe("c-1");
        expect(next.chatDrawer).toEqual({ open: false, pendingPrompt: null });
    });
});
