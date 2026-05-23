import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntdApp } from "antd";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import {
    USER_PREFERENCES_STORAGE_KEY,
    userPreferencesSlice
} from "../../store/reducers/userPreferencesSlice";
import useAuth from "../../utils/hooks/useAuth";

import TaskSearchPanel, { TaskSearchParam } from ".";

jest.mock("../../utils/hooks/useAuth");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "t1",
    columnId: "col-1",
    coordinatorId: "u1",
    epic: "Checkout",
    index: 0,
    note: "Ship it",
    projectId: "p1",
    storyPoints: 3,
    taskName: "Build checkout",
    type: "Task",
    ...overrides
});

const members = [
    member(),
    member({
        _id: "u2",
        email: "bob@example.com",
        username: "Bob"
    })
];

const defaultParam: TaskSearchParam = {
    coordinatorId: "",
    taskName: "",
    type: ""
};

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

/**
 * Phase 4.2 — the density toggle reads/writes the user-preferences
 * Redux slice, so every render wraps the panel in a Provider + a fresh
 * store. `AntdApp` is required so the AntD Segmented can resolve its
 * internal `App.useApp()` lookup without falling back to the silent
 * no-op shape.
 */
const makePanelStore = () =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: []
            }
        }
    });

const renderPanel = ({
    loading = false,
    param = defaultParam,
    panelMembers = members,
    setParam = jest.fn(),
    panelTasks = [task(), task({ _id: "t2", coordinatorId: "u2", type: "Bug" })]
}: {
    loading?: boolean;
    param?: TaskSearchParam;
    panelMembers?: IMember[] | undefined;
    setParam?: jest.Mock;
    panelTasks?: ITask[];
} = {}) => {
    const store = makePanelStore();
    render(
        <Provider store={store}>
            <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                <AntdApp>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <TaskSearchPanel
                                    loading={loading}
                                    members={panelMembers}
                                    param={param}
                                    setParam={setParam}
                                    tasks={panelTasks}
                                />
                            }
                        />
                    </Routes>
                </AntdApp>
            </MemoryRouter>
        </Provider>
    );

    return { setParam, store };
};

const openSelect = (index: number) => {
    fireEvent.mouseDown(screen.getAllByRole("combobox")[index]);
};

const getRenderedOptionLabels = () =>
    Array.from(
        document.body.querySelectorAll(".ant-select-item-option-content")
    ).map((option) => option.textContent);

describe("TaskSearchPanel", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        // The Phase 4.2 preferences persistence middleware writes to
        // `localStorage`; clear between tests so a density flip in
        // one test never resurfaces when the next builds its store.
        window.localStorage.removeItem(USER_PREFERENCES_STORAGE_KEY);
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: true,
            user: user()
        });
    });

    it("updates task name, coordinator, type, and reset filters", async () => {
        const setParam = jest.fn();
        const param = { coordinatorId: "", taskName: "checkout", type: "" };

        renderPanel({ param, setParam });

        fireEvent.change(screen.getByPlaceholderText("Search this board"), {
            target: { value: "invoice" }
        });

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: "",
            taskName: "invoice",
            type: ""
        });

        openSelect(0);
        fireEvent.click(await screen.findByText("Alice"));

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: "u1",
            taskName: "checkout",
            type: ""
        });

        openSelect(1);
        fireEvent.click(await screen.findByText("Bug"));

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: "",
            taskName: "checkout",
            type: "Bug"
        });

        fireEvent.click(screen.getByRole("button", { name: /reset filter/i }));

        expect(setParam).toHaveBeenLastCalledWith({
            coordinatorId: undefined,
            semanticIds: undefined,
            taskName: undefined,
            type: undefined
        });
    });

    it("builds unique coordinator options from tasks and members", async () => {
        renderPanel({
            panelTasks: [
                task({ _id: "t1", coordinatorId: "u1" }),
                task({ _id: "t2", coordinatorId: "u1" }),
                task({ _id: "t3", coordinatorId: "u2" })
            ]
        });

        openSelect(0);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(
                expect.arrayContaining(["Alice", "Bob"])
            );
        });
        expect(
            getRenderedOptionLabels().filter((label) => label === "Alice")
        ).toHaveLength(1);
        expect(
            getRenderedOptionLabels().filter((label) => label === "Bob")
        ).toHaveLength(1);
    });

    it("builds unique type options from tasks", async () => {
        renderPanel({
            panelTasks: [
                task({ _id: "t1", type: "Story" }),
                task({ _id: "t2", type: "Story" }),
                task({ _id: "t3", type: "Bug" })
            ]
        });

        openSelect(1);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(
                expect.arrayContaining(["Story", "Bug"])
            );
        });
        expect(
            getRenderedOptionLabels().filter((label) => label === "Story")
        ).toHaveLength(1);
        expect(
            getRenderedOptionLabels().filter((label) => label === "Bug")
        ).toHaveLength(1);
    });

    it("falls back to the current user and default task types", async () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: true,
            user: user({
                _id: "current-user",
                email: "current@example.com",
                username: "Current User"
            })
        });

        renderPanel({
            panelMembers: undefined,
            panelTasks: []
        });

        openSelect(0);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toContain("Current User");
        });

        openSelect(1);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(
                expect.arrayContaining(["Task", "Bug"])
            );
        });
    });

    it("does not add a coordinator fallback when there is no current user", async () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        renderPanel({
            panelMembers: undefined,
            panelTasks: []
        });

        openSelect(0);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(["Coordinators"]);
        });
    });

    it("clears all active filters when the FilterChips clear-all CTA is pressed", async () => {
        const rtlUser = userEvent.setup();
        const setParam = jest.fn();
        // Two active filters so the FilterChips CTA renders (it only
        // appears at 2+ chips).
        const param: TaskSearchParam = {
            coordinatorId: "u1",
            taskName: "checkout",
            type: ""
        };

        renderPanel({ param, setParam });

        await rtlUser.click(
            screen.getByRole("button", {
                name: new RegExp(`^${microcopy.actions.clear}$`, "i")
            })
        );

        expect(setParam).toHaveBeenLastCalledWith({
            coordinatorId: undefined,
            semanticIds: undefined,
            taskName: undefined,
            type: undefined
        });
    });

    it("shows loading state for both selects", () => {
        const { container } = render(
            <Provider store={makePanelStore()}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <AntdApp>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <TaskSearchPanel
                                        loading
                                        members={members}
                                        param={defaultParam}
                                        setParam={jest.fn()}
                                        tasks={[task()]}
                                    />
                                }
                            />
                        </Routes>
                    </AntdApp>
                </MemoryRouter>
            </Provider>
        );

        expect(container.querySelectorAll(".ant-select-loading")).toHaveLength(
            2
        );
    });

    /*
     * Phase 4.2 — Density toggle inside the panel. Toggling writes to
     * the slice; an external store mutation re-renders the AntD
     * Segmented at the new value.
     */
    describe("density toggle (Phase 4.2)", () => {
        it("flips the slice's boardDensity when the user picks Compact", async () => {
            const { store } = renderPanel();
            // AntD's Segmented hides the radios behind a label that
            // owns the click; click the visible label rather than the
            // hidden input (which carries `pointer-events: none`).
            const compactLabel = screen.getByText(
                microcopy.board.densityCompact
            );
            fireEvent.click(compactLabel);
            await waitFor(() => {
                expect(store.getState().userPreferences.boardDensity).toBe(
                    "compact"
                );
            });
        });

        it("reflects the slice's current value on mount", () => {
            renderPanel();
            const comfortableRadio = screen.getByRole("radio", {
                name: microcopy.board.densityComfortable
            });
            expect(comfortableRadio).toBeChecked();
        });
    });
});
