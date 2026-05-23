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
            aiDraftActiveColumnId: null,
            copilotDock: { open: false, activeTab: "chat", initialPrompt: null }
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
            aiDraftActiveColumnId: "c-1",
            copilotDock: {
                open: true,
                activeTab: "chat" as const,
                initialPrompt: null
            }
        };
        const next = overlaysSlice.reducer(
            populated,
            overlaysActions.closeChatDrawer()
        );
        expect(next.editingTaskId).toBe("t-1");
        expect(next.boardBriefOpen).toBe(true);
        expect(next.aiDraftActiveColumnId).toBe("c-1");
        expect(next.copilotDock).toEqual({
            open: true,
            activeTab: "chat",
            initialPrompt: null
        });
        expect(next.chatDrawer).toEqual({ open: false, pendingPrompt: null });
    });

    describe("copilotDock actions", () => {
        it("openCopilotDock with no payload opens on the previously-active tab without a prompt", () => {
            const next = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock()
            );
            expect(next.copilotDock).toEqual({
                open: true,
                activeTab: "chat",
                initialPrompt: null
            });
        });

        it("openCopilotDock with a tab payload switches the active tab on open", () => {
            const next = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({ tab: "brief" })
            );
            expect(next.copilotDock).toEqual({
                open: true,
                activeTab: "brief",
                initialPrompt: null
            });
        });

        it("openCopilotDock with a pendingPrompt stores the prompt for ChatTabBody to consume", () => {
            const next = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({
                    tab: "chat",
                    pendingPrompt: "Summarize the board"
                })
            );
            expect(next.copilotDock).toEqual({
                open: true,
                activeTab: "chat",
                initialPrompt: "Summarize the board"
            });
        });

        it("closeCopilotDock flips open=false and clears the initialPrompt", () => {
            const opened = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({
                    tab: "chat",
                    pendingPrompt: "hello"
                })
            );
            const closed = overlaysSlice.reducer(
                opened,
                overlaysActions.closeCopilotDock()
            );
            expect(closed.copilotDock).toEqual({
                open: false,
                activeTab: "chat",
                initialPrompt: null
            });
        });

        it("setCopilotDockTab switches the active tab without touching open/prompt", () => {
            const opened = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({
                    tab: "chat",
                    pendingPrompt: "x"
                })
            );
            const switched = overlaysSlice.reducer(
                opened,
                overlaysActions.setCopilotDockTab("brief")
            );
            expect(switched.copilotDock).toEqual({
                open: true,
                activeTab: "brief",
                initialPrompt: "x"
            });
        });

        it("clearCopilotDockInitialPrompt drops the prompt while leaving open/tab alone", () => {
            const opened = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({
                    tab: "brief",
                    pendingPrompt: "x"
                })
            );
            const cleared = overlaysSlice.reducer(
                opened,
                overlaysActions.clearCopilotDockInitialPrompt()
            );
            expect(cleared.copilotDock).toEqual({
                open: true,
                activeTab: "brief",
                initialPrompt: null
            });
        });

        /*
         * R-A M1 review Issue #9 (MINOR): a payload-less
         * `openCopilotDock()` call previously cleared any already-
         * staged prompt because the reducer ran
         * `payload?.pendingPrompt ?? null` unconditionally. The
         * documented intent is that an open dispatched with no payload
         * is a pure focus call — it must NOT destroy state staged by
         * a prior explicit open. Only an explicit
         * `{ pendingPrompt: null }` should clear it.
         */
        it("openCopilotDock with NO payload preserves any already-staged prompt (#9)", () => {
            const opened = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({
                    tab: "chat",
                    pendingPrompt: "Summarize"
                })
            );
            // A subsequent payload-less open (e.g. a focus / re-open
            // from the bottom nav) must not zero the staged prompt.
            const reopened = overlaysSlice.reducer(
                opened,
                overlaysActions.openCopilotDock()
            );
            expect(reopened.copilotDock).toEqual({
                open: true,
                activeTab: "chat",
                initialPrompt: "Summarize"
            });
        });

        it("openCopilotDock with explicit pendingPrompt: null clears the staged prompt", () => {
            const opened = overlaysSlice.reducer(
                initialState,
                overlaysActions.openCopilotDock({
                    tab: "chat",
                    pendingPrompt: "x"
                })
            );
            const cleared = overlaysSlice.reducer(
                opened,
                overlaysActions.openCopilotDock({ pendingPrompt: null })
            );
            expect(cleared.copilotDock.initialPrompt).toBeNull();
        });
    });
});
