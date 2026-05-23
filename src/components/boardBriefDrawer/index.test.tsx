import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import environment from "../../constants/env";
import useTaskModal from "../../utils/hooks/useTaskModal";

import BoardBriefDrawer from ".";

jest.mock("../../utils/hooks/useTaskModal");
// Preserve the real env (aiBaseUrl etc.) and just expose `taskPanelRouted`
// as a mutable field so individual tests can flip the flag.
jest.mock("../../constants/env", () => {
    const actual = jest.requireActual("../../constants/env");
    return {
        __esModule: true,
        default: { ...actual.default, taskPanelRouted: false }
    };
});

const mockedUseTaskModal = useTaskModal as jest.MockedFunction<
    typeof useTaskModal
>;
const mockedEnvironment = environment as { taskPanelRouted: boolean };

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

const project: IProject = {
    _id: "p1",
    createdAt: "0",
    managerId: "m1",
    organization: "Org",
    projectName: "Roadmap"
};

const columns: IColumn[] = [
    { _id: "c1", columnName: "Todo", index: 0, projectId: "p1" },
    { _id: "c2", columnName: "Done", index: 1, projectId: "p1" }
];

const members: IMember[] = [{ _id: "m1", email: "a@b.c", username: "Alice" }];

const tasks: ITask[] = [
    {
        _id: "t1",
        columnId: "c1",
        coordinatorId: "m1",
        epic: "x",
        index: 0,
        note: "",
        projectId: "p1",
        storyPoints: 13,
        taskName: "Big task",
        type: "Task"
    },
    {
        _id: "t2",
        columnId: "c1",
        coordinatorId: "ghost",
        epic: "x",
        index: 1,
        note: "",
        projectId: "p1",
        storyPoints: 3,
        taskName: "Unowned task",
        type: "Task"
    }
];

const renderDrawer = (open = true) => {
    const queryClient = new QueryClient();
    const onClose = jest.fn();
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <BoardBriefDrawer
                    columns={columns}
                    members={members}
                    onClose={onClose}
                    open={open}
                    project={project}
                    tasks={tasks}
                />
            </MemoryRouter>
        </QueryClientProvider>
    );
    return { ...utils, onClose };
};

describe("BoardBriefDrawer", () => {
    beforeAll(() => {
        installAntdMocks();
    });

    beforeEach(() => {
        mockedEnvironment.taskPanelRouted = false;
        mockedUseTaskModal.mockReturnValue({
            closeModal: jest.fn(),
            editingTaskId: undefined,
            isLoading: false,
            startEditing: jest.fn()
        } as unknown as ReturnType<typeof useTaskModal>);
    });

    it("renders headline, counts, largest unstarted, unowned, and recommendation", async () => {
        renderDrawer(true);
        expect(
            await screen.findByText(/2 tasks on the board/)
        ).toBeInTheDocument();
        expect(screen.getByText("Big task")).toBeInTheDocument();
        expect(screen.getAllByText("Unowned task").length).toBeGreaterThan(0);
        expect(screen.getByText(/Recommended next step/)).toBeInTheDocument();
    });

    it("opens a task in the existing task modal when a brief item is clicked", async () => {
        const startEditing = jest.fn();
        mockedUseTaskModal.mockReturnValue({
            closeModal: jest.fn(),
            editingTaskId: undefined,
            isLoading: false,
            startEditing
        } as unknown as ReturnType<typeof useTaskModal>);
        const { onClose } = renderDrawer(true);
        await screen.findByText("Big task");
        fireEvent.click(screen.getByText("Big task"));
        expect(startEditing).toHaveBeenCalledWith("t1");
        // PRD v3 B-R8: keep the brief drawer open so users can keep
        // scanning while drilling into tasks. Previously closed.
        expect(onClose).not.toHaveBeenCalled();
    });

    it("opens editing when an unowned task row is clicked", async () => {
        const startEditing = jest.fn();
        mockedUseTaskModal.mockReturnValue({
            closeModal: jest.fn(),
            editingTaskId: undefined,
            isLoading: false,
            startEditing
        } as unknown as ReturnType<typeof useTaskModal>);
        const { onClose } = renderDrawer(true);
        const rows = await screen.findAllByText("Unowned task");
        fireEvent.click(rows[rows.length - 1]);
        expect(startEditing).toHaveBeenCalledWith("t2");
        // PRD v3 B-R8: drawer stays open.
        expect(onClose).not.toHaveBeenCalled();
    });

    it("flag ON: a brief row click navigates to the routed task panel instead of opening the modal (Phase 3 A2)", async () => {
        mockedEnvironment.taskPanelRouted = true;
        const startEditing = jest.fn();
        mockedUseTaskModal.mockReturnValue({
            closeModal: jest.fn(),
            editingTaskId: undefined,
            isLoading: false,
            startEditing
        } as unknown as ReturnType<typeof useTaskModal>);

        const LocationProbe = () => {
            const location = useLocation();
            return (
                <div data-testid="brief-location">{`${location.pathname}${location.search}`}</div>
            );
        };

        const queryClient = new QueryClient();
        const onClose = jest.fn();
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <>
                                    <BoardBriefDrawer
                                        columns={columns}
                                        members={members}
                                        onClose={onClose}
                                        open
                                        project={project}
                                        tasks={tasks}
                                    />
                                    <LocationProbe />
                                </>
                            }
                        />
                        <Route
                            path="/projects/:projectId/board/task/:taskId"
                            element={<LocationProbe />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        await screen.findByText("Big task");
        fireEvent.click(screen.getByText("Big task"));

        await waitFor(() => {
            expect(screen.getByTestId("brief-location").textContent).toBe(
                "/projects/p1/board/task/t1"
            );
        });
        // Legacy modal-opening startEditing is NOT called when the flag
        // is on; the routed panel owns the open-task surface.
        expect(startEditing).not.toHaveBeenCalled();
    });

    it("renders nothing when open is false", () => {
        const queryClient = new QueryClient();
        const { container } = render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <BoardBriefDrawer
                        columns={columns}
                        members={members}
                        onClose={jest.fn()}
                        open={false}
                        project={project}
                        tasks={tasks}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );
        expect(container.querySelector(".ant-drawer-open")).toBeNull();
    });

    it("renders empty-state copy when board is clean", async () => {
        const queryClient = new QueryClient();
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <BoardBriefDrawer
                        columns={columns}
                        members={members}
                        onClose={jest.fn()}
                        open
                        project={project}
                        tasks={[]}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );
        // PRD v3 B-R3: when the board has no tasks the brief headline
        // calls out the empty board explicitly instead of shipping a
        // raw "0 tasks" count.
        await waitFor(() =>
            expect(screen.getByText(/Board is empty/i)).toBeInTheDocument()
        );
        expect(screen.getByText(/All tasks have an owner/)).toBeInTheDocument();
        expect(
            screen.getByText(/No unstarted tasks\. Nice\./)
        ).toBeInTheDocument();
    });
});
