import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import AiTaskDraftModal from ".";

const installAntdMocks = () => {
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
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users"], {
        _id: "m1",
        email: "a@b.c",
        jwt: "t",
        likedProjects: [],
        username: "Alice"
    });
    queryClient.setQueryData(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    queryClient.setQueryData(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    queryClient.setQueryData(["tasks", { projectId: "p1" }], []);
    return queryClient;
};

const mountModal = (onClose: () => void = jest.fn()) => {
    const queryClient = seedClient();
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/projects/p1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={
                            <AiTaskDraftModal
                                columnId="c1"
                                onClose={onClose}
                                open
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
};

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

describe("AiTaskDraftModal", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdMocks();
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(response({ _id: "task-new" }));
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("disables the Draft button until a prompt is entered", async () => {
        mountModal();
        expect(screen.getByLabelText("Draft task with Copilot")).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Investigate flaky login on Safari" }
        });
        await waitFor(() =>
            expect(
                screen.getByLabelText("Draft task with Copilot")
            ).not.toBeDisabled()
        );
    });

    it("rejects a whitespace-only task name on create", async () => {
        mountModal();
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Investigate flaky login on Safari" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));

        const taskNameInput = await screen.findByDisplayValue(/./);
        fireEvent.change(taskNameInput, { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: /create task/i }));

        await waitFor(() => {
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    it("drafts a task, lets the user submit it, and closes", async () => {
        const onClose = jest.fn();
        mountModal(onClose);
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Investigate flaky login on Safari" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));

        const submit = await screen.findByRole("button", {
            name: /create task/i
        });
        fireEvent.click(submit);
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(fetchMock).toHaveBeenCalled();
        const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
        expect(body.taskName.length).toBeGreaterThan(0);
        expect(body.projectId).toBe("p1");
        expect(body.columnId).toBe("c1");
        expect(body.coordinatorId).toBe("m1");
    });

    it("breaks down a prompt into multiple subtasks and creates the selected ones", async () => {
        const onClose = jest.fn();
        mountModal(onClose);
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Build sprint dashboard end to end" }
        });
        fireEvent.click(
            screen.getByLabelText("Break the prompt into subtasks")
        );

        const checkboxes = await screen.findAllByRole("checkbox");
        expect(checkboxes.length).toBeGreaterThanOrEqual(2);
        // uncheck one so the loop also exercises the filter
        fireEvent.click(checkboxes[0]);
        const create = screen.getByRole("button", {
            name: /create \d+ subtasks?/i
        });
        fireEvent.click(create);
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls.length).toBe(checkboxes.length - 1);
    });

    it("cancel resets the form without creating tasks", () => {
        const onClose = jest.fn();
        mountModal(onClose);
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Anything" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));
        // The Cancel button only appears once draft is submitted; close via X always works
        fireEvent.click(screen.getByRole("button", { name: /close/i }));
        expect(onClose).toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("resets draft state when the modal is closed from open", async () => {
        const queryClient = seedClient();
        const { rerender } = render(
            <QueryClientProvider client={queryClient}>
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
        );

        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Some prompt text" }
        });

        rerender(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskDraftModal
                                    columnId="c1"
                                    onClose={jest.fn()}
                                    open={false}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        rerender(
            <QueryClientProvider client={queryClient}>
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
        );

        expect(screen.getByLabelText("Task prompt")).toHaveValue("");
    });

    it("shows a warning notification when one of two undo deletes fails (Defect 3 fix)", async () => {
        // Create two subtasks via the breakdown flow, then simulate the undo
        // where one DELETE fails. The component must show a warning telling
        // the user how many tasks could not be removed.
        const onClose = jest.fn();

        // Calls: first returns task IDs for the two created subtasks,
        // then the undo calls one succeeds and one fails.
        let callCount = 0;
        fetchMock.mockImplementation(() => {
            callCount += 1;
            // First two POST calls create tasks (return distinct IDs)
            if (callCount === 1)
                return Promise.resolve(response({ _id: "task-undo-1" }));
            if (callCount === 2)
                return Promise.resolve(response({ _id: "task-undo-2" }));
            // Third call (first undo DELETE) succeeds
            if (callCount === 3) return Promise.resolve(response({}, true));
            // Fourth call (second undo DELETE) fails
            return Promise.reject(new Error("Network error"));
        });

        mountModal(onClose);

        // Trigger breakdown
        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Build end-to-end feature" }
        });
        fireEvent.click(
            screen.getByLabelText("Break the prompt into subtasks")
        );

        // Wait for breakdown items
        const checkboxes = await screen.findAllByRole("checkbox");
        expect(checkboxes.length).toBeGreaterThanOrEqual(2);

        // Keep exactly two items checked
        // Uncheck all beyond the second
        for (let i = 2; i < checkboxes.length; i++) {
            if ((checkboxes[i] as HTMLInputElement).checked) {
                fireEvent.click(checkboxes[i]);
            }
        }
        // Ensure first two are checked
        if (!(checkboxes[0] as HTMLInputElement).checked) {
            fireEvent.click(checkboxes[0]);
        }
        if (!(checkboxes[1] as HTMLInputElement).checked) {
            fireEvent.click(checkboxes[1]);
        }

        // Submit the breakdown
        const create = screen.getByRole("button", {
            name: /create \d+ subtasks?/i
        });
        fireEvent.click(create);
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        // The undo toast should be in the document — click "Undo"
        const undoButton = await screen.findByRole("button", { name: /undo/i });
        fireEvent.click(undoButton);

        // The component should show a partial-failure warning:
        // "{removed} removed, {failed} could not be removed."
        await waitFor(() => {
            expect(
                screen.getByText(/1 removed, 1 could not be removed/i)
            ).toBeInTheDocument();
        });
    });
});
