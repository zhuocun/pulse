import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import {
    aiLedgerActions,
    type AiLedgerEntryState
} from "../../store/reducers/aiLedgerSlice";
import { __resetAiLedgerUndoCallbacksForTests } from "../../utils/hooks/useAiLedger";

jest.mock("../../utils/hooks/useAi", () => ({
    __esModule: true,
    default: jest.fn()
}));
jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiUseLocalEngine: true,
        aiBaseUrl: "",
        copilotDockEnabled: true,
        taskPanelRouted: false
    }
}));
/*
 * Intercept the toast helper so the test can drive the in-toast Undo
 * callback synchronously — the real implementation goes through AntD's
 * `message.open` which is fiddly to script in jsdom. The mock captures
 * the latest `undo` callback to a ref the test can invoke.
 */
const capturedToastUndo: { undo: (() => void | Promise<void>) | null } = {
    undo: null
};
jest.mock("../../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({
        show: (options: { undo: () => void | Promise<void> }) => {
            capturedToastUndo.undo = options.undo;
            return { dismiss: jest.fn() };
        }
    })
}));

// eslint-disable-next-line simple-import-sort/imports
import useAi from "../../utils/hooks/useAi";

import AiTaskAssistPanel from ".";

const mockedUseAi = useAi as jest.MockedFunction<typeof useAi>;

const seedClient = () => {
    const client = new QueryClient();
    client.setQueryData(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    client.setQueryData(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    client.setQueryData(["tasks", { projectId: "p1" }], []);
    return client;
};

const renderPanel = (
    overrides: {
        estimateData?: {
            storyPoints: number;
            confidence: number;
            rationale: string;
        };
        onApplyStoryPoints?: jest.Mock;
    } = {}
) => {
    const estimateData = overrides.estimateData ?? {
        storyPoints: 5,
        confidence: 0.9,
        rationale: "Similar to existing tasks",
        similar: []
    };
    const onApplyStoryPoints = overrides.onApplyStoryPoints ?? jest.fn();
    mockedUseAi.mockImplementation(((args: { route: string }) => {
        if (args.route === "estimate") {
            return {
                abort: jest.fn(),
                data: estimateData,
                error: null,
                isLoading: false,
                reset: jest.fn(),
                run: jest.fn().mockResolvedValue(undefined)
            };
        }
        return {
            abort: jest.fn(),
            data: { issues: [] },
            error: null,
            isLoading: false,
            reset: jest.fn(),
            run: jest.fn().mockResolvedValue(undefined)
        };
    }) as unknown as typeof mockedUseAi);
    render(
        <Provider store={store}>
            <QueryClientProvider client={seedClient()}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskAssistPanel
                                    onApplyStoryPoints={onApplyStoryPoints}
                                    onApplySuggestion={jest.fn()}
                                    onOpenSimilarTask={jest.fn()}
                                    values={{
                                        taskName: "Login refactor",
                                        storyPoints: 2
                                    }}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return { onApplyStoryPoints };
};

const getLedgerEntries = (): readonly AiLedgerEntryState[] =>
    store.getState().aiLedger.entries;

describe("AiTaskAssistPanel — activity ledger wiring (A8)", () => {
    beforeEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
        capturedToastUndo.undo = null;
    });

    afterEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
        capturedToastUndo.undo = null;
    });

    it("logs an activity-ledger entry tagged 'task-assist' when story points are applied", async () => {
        renderPanel();
        // Wait for the suggestion to render so the Apply button mounts.
        const applyButton = await screen.findByRole("button", {
            name: /Apply suggested story points/i
        });
        act(() => {
            fireEvent.click(applyButton);
        });
        const entries = getLedgerEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].surface).toBe("task-assist");
        expect(entries[0].description).toContain("5");
        expect(entries[0].description).toContain("Login refactor");
        expect(entries[0].undoable).toBe(true);
    });

    /*
     * Regression test for A8 review issue #3. Before the fix, clicking
     * the 10 s undoToast Undo button reverted the field but left the
     * ledger entry with a still-live closure. The fix shares a
     * `performUndo` between toast + ledger and the toast additionally
     * calls `removeLedger(id)` so the row drops in the same tick.
     */
    it("toast Undo removes the ledger entry and ledger Revert becomes a no-op (issue #3)", async () => {
        const onApplyStoryPoints = jest.fn();
        renderPanel({ onApplyStoryPoints });
        const applyButton = await screen.findByRole("button", {
            name: /Apply suggested story points/i
        });
        act(() => {
            fireEvent.click(applyButton);
        });
        // After Apply: one ledger entry is present and onApplyStoryPoints
        // has been called once with the suggested value.
        const entriesBefore = getLedgerEntries();
        expect(entriesBefore).toHaveLength(1);
        expect(onApplyStoryPoints).toHaveBeenCalledTimes(1);
        expect(onApplyStoryPoints).toHaveBeenLastCalledWith(5);

        // Fire the captured toast Undo callback. This should invoke
        // the inverse (restore previous value, 2) AND drop the ledger
        // entry so it no longer shows in the dock.
        expect(capturedToastUndo.undo).not.toBeNull();
        await act(async () => {
            await capturedToastUndo.undo!();
        });

        // onApplyStoryPoints was called a second time with the previous
        // value (2) — the inverse landed.
        expect(onApplyStoryPoints).toHaveBeenCalledTimes(2);
        expect(onApplyStoryPoints).toHaveBeenLastCalledWith(2);

        // And the ledger row dropped — clicking ledger Revert in the
        // dock would now find no entry.
        expect(getLedgerEntries()).toHaveLength(0);
    });
});
