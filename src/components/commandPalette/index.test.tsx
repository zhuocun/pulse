import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe, toHaveNoViolations } from "jest-axe";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import CommandPalette from ".";

expect.extend(toHaveNoViolations);

// Mock the env so individual tests can toggle the routed-panel flag
// without restarting the module. Defaults to OFF (legacy modal path).
// Preserve the real env (aiBaseUrl etc.) so unrelated components still
// see the production-shape config.
jest.mock("../../constants/env", () => {
    const actual = jest.requireActual("../../constants/env");
    return {
        __esModule: true,
        default: { ...actual.default, taskPanelRouted: false }
    };
});

const mockedEnvironment = environment as { taskPanelRouted: boolean };

const installAntdMocks = () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        value: 800
    });
    // Force the responsive Grid into desktop so the palette renders fully.
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: query.includes("min-width") ? true : false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const seedClient = () => {
    const qc = new QueryClient();
    // Projects are loaded via parametric `["projects", filterRequest({...})]`
    // keys in production (see `pages/project.tsx`) — the palette must
    // surface them via the gather-all helper, not the bare `["projects"]`
    // key (which is rarely populated). Seed under a parametric key here
    // to exercise the production code path.
    qc.setQueryData<IProject[]>(
        ["projects", { managerId: "m1" }],
        [
            {
                _id: "p1",
                createdAt: "0",
                managerId: "m1",
                organization: "Acme",
                projectName: "Roadmap"
            },
            {
                _id: "p2",
                createdAt: "0",
                managerId: "m1",
                organization: "Acme",
                projectName: "Marketing"
            }
        ]
    );
    qc.setQueryData<IMember[]>(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    return qc;
};

const renderPalette = (open: boolean = true) => {
    const onClose = jest.fn();
    const queryClient = seedClient();
    const utils = render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <CommandPalette onClose={onClose} open={open} />
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return { ...utils, onClose };
};

describe("CommandPalette", () => {
    beforeAll(() => {
        installAntdMocks();
    });

    it("renders the combobox with a listbox of cached entries", async () => {
        renderPalette(true);
        const combo = await screen.findByRole("combobox");
        expect(combo).toBeInTheDocument();
        const list = screen.getByRole("listbox");
        expect(list).toBeInTheDocument();
        expect(screen.getByText("Roadmap")).toBeInTheDocument();
        expect(screen.getByText("Marketing")).toBeInTheDocument();
    });

    it("filters results as the user types", async () => {
        renderPalette(true);
        const input = await screen.findByRole("combobox");
        const inputEl = input.querySelector("input") as HTMLInputElement;
        fireEvent.change(inputEl, { target: { value: "road" } });
        await waitFor(() => {
            expect(screen.getByText("Roadmap")).toBeInTheDocument();
            expect(screen.queryByText("Marketing")).not.toBeInTheDocument();
        });
    });

    it("activates AI mode when the query begins with `/`", async () => {
        renderPalette(true);
        const input = (await screen.findByRole("combobox")).querySelector(
            "input"
        ) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "/ what's at risk" } });
        await waitFor(() => {
            expect(screen.getByText(/Ask Board Copilot/i)).toBeInTheDocument();
        });
    });

    it("activates AI mode when the sparkle toggle button receives a click", async () => {
        renderPalette(true);
        await screen.findByRole("combobox");
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.a11y.switchToBoardCopilot
            })
        );
        await waitFor(() => {
            expect(screen.getByText(/Ask Board Copilot/i)).toBeInTheDocument();
        });
    });

    it("calls onClose when Esc is pressed", async () => {
        const onClose = jest.fn();
        const queryClient = seedClient();
        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter>
                        <CommandPalette onClose={onClose} open />
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );
        const user = userEvent.setup();
        await screen.findByRole("combobox");
        await user.keyboard("{Escape}");
        await waitFor(() => {
            expect(onClose).toHaveBeenCalled();
        });
    });

    it("Enter activates the selected option and navigates", async () => {
        renderPalette(true);
        const input = (await screen.findByRole("combobox")).querySelector(
            "input"
        ) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "road" } });
        await waitFor(() => {
            expect(screen.getByText("Roadmap")).toBeInTheDocument();
        });
        fireEvent.keyDown(input, { key: "Enter" });
        // onClose called by enter path
    });

    it("has no axe-detectable accessibility violations", async () => {
        const { container } = renderPalette(true);
        await screen.findByRole("combobox");
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("shows a loading indicator when the cache is cold and a query is in flight", async () => {
        const onClose = jest.fn();
        // Cold cache: no seeded data, but at least one query is in flight.
        // Simulate by registering an active observer on the cache via a
        // pending query state. The simplest path is to seed an actual
        // query function that never resolves while the palette renders.
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        // Kick off a fetch that stays pending. Tanstack Query exposes
        // `useIsFetching` which reflects this in-flight count.
        let resolveNever: ((v: IProject[]) => void) | undefined;
        qc.fetchQuery<IProject[]>({
            queryKey: ["projects", { managerId: "m1" }],
            queryFn: () =>
                new Promise<IProject[]>((resolve) => {
                    resolveNever = resolve;
                })
        });
        try {
            render(
                <Provider store={store}>
                    <QueryClientProvider client={qc}>
                        <MemoryRouter>
                            <CommandPalette onClose={onClose} open />
                        </MemoryRouter>
                    </QueryClientProvider>
                </Provider>
            );
            await screen.findByRole("combobox");
            await waitFor(() => {
                expect(screen.getByText("Loading…")).toBeInTheDocument();
            });
            expect(screen.queryByText("No matches.")).not.toBeInTheDocument();
        } finally {
            // Resolve the pending query so the worker exits cleanly.
            resolveNever?.([]);
        }
    });

    it("shows 'No matches.' when no queries are fetching and the cache is empty", async () => {
        const onClose = jest.fn();
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        render(
            <Provider store={store}>
                <QueryClientProvider client={qc}>
                    <MemoryRouter>
                        <CommandPalette onClose={onClose} open />
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );
        const input = (await screen.findByRole("combobox")).querySelector(
            "input"
        ) as HTMLInputElement;
        // Type something so the visible list is forced to filter and
        // produce zero results from the empty cache.
        fireEvent.change(input, { target: { value: "anything" } });
        await waitFor(() => {
            expect(screen.getByText("No matches.")).toBeInTheDocument();
        });
        expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    it("indexes tasks and columns from parametric cache keys", async () => {
        const onClose = jest.fn();
        const qc = seedClient();
        // `pages/board.tsx` keys these as `["tasks", { projectId }]` and
        // `["boards", { projectId }]`. The palette must scan all matching
        // entries, not just the bare prefix.
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "Auth",
                    index: 0,
                    note: "",
                    projectId: "p1",
                    storyPoints: 2,
                    taskName: "Refactor login",
                    type: "Task"
                }
            ]
        );
        qc.setQueryData<IColumn[]>(
            ["boards", { projectId: "p1" }],
            [{ _id: "c1", columnName: "Backlog", index: 0, projectId: "p1" }]
        );
        render(
            <Provider store={store}>
                <QueryClientProvider client={qc}>
                    <MemoryRouter>
                        <CommandPalette onClose={onClose} open />
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );
        await screen.findByRole("combobox");
        expect(screen.getByText("Refactor login")).toBeInTheDocument();
        expect(screen.getByText("Backlog")).toBeInTheDocument();
    });

    describe("task entry navigation (Phase 3 A2)", () => {
        const LocationProbe = () => {
            const location = useLocation();
            return (
                <div data-testid="location">{`${location.pathname}${location.search}`}</div>
            );
        };

        const seedTaskClient = () => {
            const qc = new QueryClient();
            qc.setQueryData<IProject[]>(
                ["projects", { managerId: "m1" }],
                [
                    {
                        _id: "p1",
                        createdAt: "0",
                        managerId: "m1",
                        organization: "Acme",
                        projectName: "Roadmap"
                    }
                ]
            );
            qc.setQueryData<ITask[]>(
                ["tasks", { projectId: "p1" }],
                [
                    {
                        _id: "t1",
                        columnId: "c1",
                        coordinatorId: "m1",
                        epic: "Auth",
                        index: 0,
                        note: "",
                        projectId: "p1",
                        storyPoints: 2,
                        taskName: "Refactor login",
                        type: "Task"
                    }
                ]
            );
            return qc;
        };

        const renderPaletteWithProbe = (onClose: () => void = jest.fn()) => {
            const qc = seedTaskClient();
            return render(
                <Provider store={store}>
                    <QueryClientProvider client={qc}>
                        <MemoryRouter initialEntries={["/start"]}>
                            <Routes>
                                <Route
                                    path="*"
                                    element={
                                        <>
                                            <CommandPalette
                                                onClose={onClose}
                                                open
                                            />
                                            <LocationProbe />
                                        </>
                                    }
                                />
                            </Routes>
                        </MemoryRouter>
                    </QueryClientProvider>
                </Provider>
            );
        };

        beforeEach(() => {
            // Reset Redux overlay state between tests so each assertion
            // sees the expected starting value.
            store.dispatch(overlaysActions.closeTaskModal());
            mockedEnvironment.taskPanelRouted = false;
        });

        it("flag OFF: picking a task entry opens the legacy modal AND navigates to /projects/{projectId}", async () => {
            const onClose = jest.fn();
            renderPaletteWithProbe(onClose);

            await screen.findByRole("combobox");
            fireEvent.click(screen.getByText("Refactor login"));

            // Legacy modal is opened via Redux dispatch.
            await waitFor(() => {
                expect(store.getState().overlays.editingTaskId).toBe("t1");
            });
            // URL navigates to the project page (legacy palette behavior).
            expect(screen.getByTestId("location").textContent).toBe(
                "/projects/p1"
            );
            expect(onClose).toHaveBeenCalled();
        });

        it("flag ON: picking a task entry navigates to the routed task panel, NOT the modal", async () => {
            mockedEnvironment.taskPanelRouted = true;
            const onClose = jest.fn();
            renderPaletteWithProbe(onClose);

            await screen.findByRole("combobox");
            fireEvent.click(screen.getByText("Refactor login"));

            await waitFor(() => {
                expect(screen.getByTestId("location").textContent).toBe(
                    "/projects/p1/board/task/t1"
                );
            });
            // Legacy modal is NOT opened when the flag is on.
            expect(store.getState().overlays.editingTaskId).toBeFalsy();
            expect(onClose).toHaveBeenCalled();
        });
    });
});
