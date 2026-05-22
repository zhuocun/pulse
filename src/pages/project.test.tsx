import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { store } from "../store";
import { overlaysActions } from "../store/reducers/overlaysSlice";
import { projectActions } from "../store/reducers/projectModalSlice";

import ProjectPage from "./project";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "project-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const members = [
    member(),
    member({
        _id: "member-2",
        email: "bob@example.com",
        username: "Bob"
    })
];

const projects = [
    project(),
    project({
        _id: "project-2",
        managerId: "member-2",
        organization: "Finance",
        projectName: "Billing"
    })
];

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const silenceExpectedConsoleErrors = (expectedMessages: string[][]) => {
    return jest
        .spyOn(console, "error")
        .mockImplementation((...args: Parameters<typeof console.error>) => {
            const message = args.map(String).join(" ");

            if (
                expectedMessages.some((fragments) =>
                    fragments.every((fragment) => message.includes(fragment))
                )
            ) {
                return;
            }

            throw new Error(`Unexpected console.error: ${message}`);
        });
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

const LocationProbe = () => {
    const location = useLocation();

    return <div data-testid="location">{location.search}</div>;
};

const renderPage = (route = "/projects") => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[route]}>
                    <Routes>
                        <Route
                            path="/projects"
                            element={
                                <>
                                    <ProjectPage />
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

describe("ProjectPage", () => {
    const fetchMock = jest.spyOn(global, "fetch");
    const oldTitle = document.title;
    let consoleErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        installAntdBrowserMocks();
        consoleErrorSpy = silenceExpectedConsoleErrors([
            ["Warning: An update to", "ProjectPage", "not wrapped in act"],
            ["Project fetch failed"]
        ]);
    });

    beforeEach(() => {
        jest.useRealTimers();
        localStorage.clear();
        store.dispatch(projectActions.closeModal());
        store.dispatch(overlaysActions.closeChatDrawer());
        store.dispatch(overlaysActions.closeBoardBrief());
        store.dispatch(overlaysActions.closeTaskModal());
        store.dispatch(overlaysActions.closeAiDraft());
        fetchMock.mockReset();
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return Promise.resolve(response(projects));
            }

            return Promise.resolve(response({}));
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        document.title = oldTitle;
    });

    afterAll(() => {
        consoleErrorSpy.mockRestore();
        fetchMock.mockRestore();
    });

    it("reads URL filters, fetches projects and members, and restores the page title", async () => {
        const { unmount } = renderPage(
            "/projects?projectName=Road&managerId=member-1"
        );

        expect(document.title).toBe("Projects · Pulse");
        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
        expect(screen.getByText("Billing")).toBeInTheDocument();
        expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
        expect(screen.getByPlaceholderText("Search this list")).toHaveValue(
            "Road"
        );
        expect(
            fetchMock.mock.calls.some(([url]) =>
                String(url).includes(
                    "/api/v1/projects?projectName=Road&managerId=member-1"
                )
            )
        ).toBe(true);

        unmount();
        expect(document.title).toBe(oldTitle);
    });

    it("shows loading first and then the empty table state", async () => {
        let resolveProjects: (value: Response) => void = () => undefined;
        let resolveMembers: (value: Response) => void = () => undefined;
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return new Promise<Response>((resolve) => {
                    resolveMembers = resolve;
                });
            }
            if (url.includes("projects")) {
                return new Promise<Response>((resolve) => {
                    resolveProjects = resolve;
                });
            }

            return Promise.resolve(response({}));
        });
        const { container } = renderPage();

        // The project list now renders skeleton cards while loading instead
        // of an AntD <Spin>; the skeleton placeholders carry the
        // `.ant-skeleton` class.
        expect(container.querySelector(".ant-skeleton")).toBeInTheDocument();

        resolveProjects(response([]));
        resolveMembers(response([]));

        expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
    });

    // QW-14: the StatRail previously used `aria-hidden={pLoading}`, which
    // blanked the three stat cards from AT during load and never
    // re-announced them when they resolved. Swap to `aria-busy` and add a
    // polite live region that narrates "Loading project stats" while in
    // flight and the resolved counts once both queries land. Keyboard /
    // SR users now hear the entire stat block as a single sentence.
    it("uses aria-busy on the stat rail and announces the resolved counts", async () => {
        let resolveProjects: (value: Response) => void = () => undefined;
        let resolveMembers: (value: Response) => void = () => undefined;
        fetchMock.mockImplementation((input) => {
            const url = String(input);
            if (url.includes("users/members")) {
                return new Promise<Response>((resolve) => {
                    resolveMembers = resolve;
                });
            }
            if (url.includes("projects")) {
                return new Promise<Response>((resolve) => {
                    resolveProjects = resolve;
                });
            }
            return Promise.resolve(response({}));
        });

        renderPage();

        // Pre-resolve: the "Total projects" label always renders. Walk up
        // its DOM to the StatRail container and assert `aria-busy="true"`
        // (the page was previously stamped with `aria-hidden`, which
        // would have wholly removed the rail from the AT tree).
        const totalProjectsLabel = await screen.findByText(/total projects/i);
        const statRail = totalProjectsLabel.closest('[aria-busy="true"]');
        expect(statRail).toBeInTheDocument();

        // The live region announces "Loading project stats" while busy.
        await waitFor(() => {
            const liveRegion = screen
                .getAllByRole("status")
                .find((node) =>
                    node.textContent?.includes("Loading project stats")
                );
            expect(liveRegion).toBeDefined();
            expect(liveRegion).toHaveAttribute("aria-live", "polite");
        });

        resolveProjects(response(projects));
        resolveMembers(response(members));

        // Once both queries land, the rail is no longer busy and the
        // live region replays the resolved counts as one polite sentence
        // ("2 projects across 2 organizations, 2 team members.").
        await waitFor(() => {
            expect(totalProjectsLabel.closest("[aria-busy]")).toHaveAttribute(
                "aria-busy",
                "false"
            );
        });
        await waitFor(() => {
            const liveRegion = screen
                .getAllByRole("status")
                .find((node) =>
                    node.textContent?.includes(
                        "2 projects across 2 organizations"
                    )
                );
            expect(liveRegion).toBeDefined();
        });
    });

    it("shows a shared error message when either query fails", async () => {
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return Promise.resolve(
                    response({ error: "Project fetch failed" }, false)
                );
            }

            return Promise.resolve(response({}));
        });

        renderPage();

        expect(
            await screen.findByText(/couldn't load\. please try again\./i)
        ).toBeInTheDocument();
    });

    it("opens the project modal through Redux state from the create button", async () => {
        renderPage();

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Create project" }));

        expect(store.getState().projectModal.isModalOpened).toBe(true);
    });

    it("debounces project search URL params before refetching projects", async () => {
        jest.useFakeTimers();
        try {
            renderPage("/projects?projectName=Road");

            expect(await screen.findByText("Roadmap")).toBeInTheDocument();
            fetchMock.mockClear();

            fireEvent.change(screen.getByPlaceholderText("Search this list"), {
                target: { value: "Billing" }
            });

            expect(screen.getByTestId("location")).toHaveTextContent(
                "projectName=Billing"
            );
            expect(
                fetchMock.mock.calls.some(([url]) =>
                    String(url).includes("projectName=Billing")
                )
            ).toBe(false);

            await act(async () => {
                jest.advanceTimersByTime(400);
            });

            await waitFor(() =>
                expect(
                    fetchMock.mock.calls.some(([url]) =>
                        String(url).includes("projectName=Billing")
                    )
                ).toBe(true)
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("opens AI chat drawer on non-board route when boardCopilot:openChat fires (Defect 2 fix)", async () => {
        renderPage();

        // Wait for the page to be ready (projects loaded)
        expect(await screen.findByText("Roadmap")).toBeInTheDocument();

        // The "Ask Board Copilot" button should be visible because aiEnabled
        // defaults to true — confirming the drawer mount point is active.
        expect(
            screen.getByRole("button", { name: "Ask Board Copilot" })
        ).toBeInTheDocument();

        // Simulate the command palette dispatching the event from a non-board route
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("boardCopilot:openChat", {
                    detail: { prompt: "What is at risk?" }
                })
            );
        });

        // After the event fires, the project page's handler opens the AI
        // drawer via `useAiChatDrawer`. The drawer is now Redux-driven; verify
        // the slice flipped instead of inspecting the URL.
        await waitFor(() => {
            expect(store.getState().overlays.chatDrawer.open).toBe(true);
        });
    });
});
