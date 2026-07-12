import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
import { __resetAiLedgerUndoCallbacksForTests } from "../../utils/hooks/useAiLedger";

import AiTaskDraftModal from ".";

const installBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: () => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: "",
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const seedClient = () => {
    const qc = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    qc.setQueryData(["users"], {
        _id: "m1",
        email: "a@b.c",
        jwt: "t",
        likedProjects: [],
        username: "Alice"
    });
    qc.setQueryData(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    qc.setQueryData(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    qc.setQueryData(["tasks", { projectId: "p1" }], []);
    return qc;
};

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

describe("AiTaskDraftModal — activity ledger wiring (A8)", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installBrowserMocks();
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(
            response({ _id: "task-created-1", taskName: "Refactor auth" })
        );
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    afterEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("logs a 'task-draft' entry with the created task name when the single draft submits", async () => {
        const qc = seedClient();
        render(
            <Provider store={store}>
                <QueryClientProvider client={qc}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <AiTaskDraftModal
                                        columnId="c1"
                                        onClose={jest.fn()}
                                        open
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        // Prime the prompt and trigger Draft → which would go through useAi
        // when env.aiUseLocalEngine=true. The default test env runs the
        // local engine, so useAi.run resolves with a real suggestion shape
        // and the form populates with the AI fields. We then call
        // createTask through the Create button click.
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Refactor auth" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));

        // Wait for the form to be visible after the local AI suggestion lands.
        const taskNameInput = await waitFor(() => {
            const field = screen.queryByLabelText(/Task name/i);
            if (!field) throw new Error("Form not populated yet");
            return field;
        });
        // The local engine fills in `taskName` from the prompt; assert it.
        expect(taskNameInput).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /Create task/i }));

        await waitFor(() => {
            const entries = store.getState().aiLedger.entries;
            expect(entries.length).toBeGreaterThanOrEqual(1);
            expect(entries[entries.length - 1].surface).toBe("task-draft");
            expect(entries[entries.length - 1].undoable).toBe(true);
        });
    });
});
