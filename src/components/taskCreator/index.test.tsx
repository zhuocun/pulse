import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";

import TaskCreator from ".";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    ...overrides
});

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const renderCreator = ({
    disabled = false,
    boardAiOn = true
}: { disabled?: boolean; boardAiOn?: boolean } = {}) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users"], user());

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <TaskCreator
                                    boardAiOn={boardAiOn}
                                    columnId="column-1"
                                    disabled={disabled}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("TaskCreator", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
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
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(
            response({
                _id: "task-1",
                taskName: "New task"
            })
        );
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    const createButton = () =>
        screen.getByRole("button", { name: /^create task$/i });

    it("starts in link mode, exits on blur, and clears draft text", () => {
        renderCreator();

        fireEvent.click(createButton());
        fireEvent.change(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                target: { value: "Draft task" }
            }
        );
        fireEvent.blur(screen.getByPlaceholderText("What needs to be done?"));

        expect(createButton()).toBeInTheDocument();

        fireEvent.click(createButton());

        expect(
            screen.getByPlaceholderText("What needs to be done?")
        ).toHaveValue("");
    });

    it("creates a task with route, column, current user, and default fields", async () => {
        renderCreator();

        fireEvent.click(createButton());
        fireEvent.change(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                target: { value: "Investigate outage" }
            }
        );
        fireEvent.keyDown(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                charCode: 13,
                code: "Enter",
                key: "Enter"
            }
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/tasks");
        expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
            columnId: "column-1",
            coordinatorId: "member-1",
            epic: "New Feature",
            note: "No note yet",
            projectId: "project-1",
            storyPoints: 1,
            taskName: "Investigate outage",
            type: "Task"
        });
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({ method: "POST" })
        );
        expect(createButton()).toBeInTheDocument();
    });

    it("disables the create button when the parent column is disabled", () => {
        renderCreator({ disabled: true });

        expect(createButton()).toBeDisabled();
    });

    it("hides Draft with AI when boardAiOn is false", () => {
        renderCreator({ boardAiOn: false });
        expect(
            screen.queryByLabelText(microcopy.actions.draftWithAi)
        ).not.toBeInTheDocument();
    });

    it("opens the Board Copilot draft modal from the Draft with AI button", async () => {
        renderCreator();
        fireEvent.click(screen.getByLabelText(microcopy.actions.draftWithAi));
        await waitFor(() =>
            expect(screen.getByLabelText("Task prompt")).toBeInTheDocument()
        );
    });

    it("closes the draft modal and returns to link mode", async () => {
        renderCreator();
        fireEvent.click(screen.getByLabelText(microcopy.actions.draftWithAi));
        await waitFor(() =>
            expect(screen.getByLabelText("Task prompt")).toBeInTheDocument()
        );
        fireEvent.click(screen.getByRole("button", { name: /close/i }));
        await waitFor(() => {
            expect(
                screen.queryByLabelText("Task prompt")
            ).not.toBeInTheDocument();
        });
        expect(
            screen.getByLabelText(microcopy.actions.draftWithAi)
        ).toBeInTheDocument();
    });
});
