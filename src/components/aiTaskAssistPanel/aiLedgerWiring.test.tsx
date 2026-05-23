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
    });

    afterEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
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
});
