/**
 * Persistence test for `<CopilotDockHost />` (Phase 4 R-A M1).
 *
 * The dock host is mounted inside `MainLayout` so the dock surface
 * survives every project-route navigation. The acceptance contract:
 *   1. Open dock on `/projects/p1/board` → switch to `/projects/p2/board`
 *      → dock stays open, the same tab is active, the brief reflects
 *      p2's data
 *   2. Chat history persists across the switch (the body is the same
 *      React instance — it doesn't unmount)
 *   3. The host is a no-op when the URL is off-board
 *
 * These tests render the host inside a small in-memory routing
 * harness so we can drive the URL changes from a sibling control
 * link and observe the dock state across them.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { Provider } from "react-redux";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true,
        aiMutationProposalsEnabled: false,
        aiKnowledgeCutoff: "January 2026",
        bottomNavEnabled: false,
        taskPanelRouted: false,
        copilotDockEnabled: true
    }
}));

// Mock the AI chat / agent hooks so the ChatTabBody renders without
// firing any real requests. We're testing persistence, not the
// underlying engines.
jest.mock("../../utils/hooks/useAiChat", () => ({
    __esModule: true,
    default: jest.fn()
}));
jest.mock("../../utils/hooks/useAgent", () => ({
    __esModule: true,
    default: jest.fn()
}));

// eslint-disable-next-line simple-import-sort/imports
import useAiChat from "../../utils/hooks/useAiChat";
import useAgent from "../../utils/hooks/useAgent";
import type { UseAgentResult } from "../../utils/hooks/useAgent";
import type { AiChatMessage } from "../../utils/ai/chatEngine";

import CopilotDockHost from "./copilotDockHost";

const mockedUseAiChat = useAiChat as jest.MockedFunction<typeof useAiChat>;
const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;

type UseAiChatResult = ReturnType<typeof useAiChat>;

const baseAiChat = (
    overrides: Partial<UseAiChatResult> = {}
): UseAiChatResult => ({
    abort: jest.fn(),
    dismissError: jest.fn(),
    error: null,
    isLoading: false,
    messages: [] as AiChatMessage[],
    reset: jest.fn(),
    seedMessages: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
    streamingText: "",
    ...overrides
});

const baseAgent = (
    overrides: Partial<UseAgentResult> = {}
): UseAgentResult => ({
    start: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn(),
    seedMessages: jest.fn(),
    isStreaming: false,
    status: "idle",
    state: { messages: [] },
    pendingInterrupt: null,
    pendingProposal: null,
    citations: [],
    nudges: [],
    lastSuggestion: null,
    error: null,
    reset: jest.fn(),
    threadId: "t_test",
    ttftMs: null,
    isSlowTtft: false,
    clearPendingProposal: jest.fn(),
    clearSuggestion: jest.fn(),
    dismissNudge: jest.fn(),
    ...overrides
});

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

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "p1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-p1-a",
    columnName: "Todo",
    index: 0,
    projectId: "p1",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-p1-a",
    columnId: "column-p1-a",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "",
    projectId: "p1",
    storyPoints: 3,
    taskName: "Task A",
    type: "Task",
    ...overrides
});

const response = (body: unknown, ok = true) =>
    ({
        ok,
        status: ok ? 200 : 400,
        json: jest.fn().mockResolvedValue(body),
        text: jest.fn().mockResolvedValue(JSON.stringify(body))
    }) as unknown as Response;

interface HarnessOptions {
    initialRoute?: string;
}

/**
 * Small in-memory routing harness around the host. We render a page
 * with a `Link` for switching projects so we can drive route changes
 * the way React Router 7 does in production (rather than rerendering
 * the MemoryRouter with a new `initialEntries`, which would also
 * destroy and remount everything).
 */
const renderHarness = ({
    initialRoute = "/projects/p1/board"
}: HarnessOptions = {}) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    // Reset the host's slice state so a previous test's open dock
    // doesn't leak into this one.
    store.dispatch(overlaysActions.closeCopilotDock());
    store.dispatch(overlaysActions.closeChatDrawer());
    store.dispatch(overlaysActions.closeBoardBrief());

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[initialRoute]}>
                    {/*
                     * The dock host mounts ABOVE the routed Outlet in
                     * production (inside MainLayout). The harness
                     * mirrors that layering: host first, then a routed
                     * stub page that owns the navigation Link.
                     */}
                    <AntdApp>
                        <CopilotDockHost />
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <div>
                                        <h1>Board page</h1>
                                        <Link to="/projects/p2/board">
                                            Go to p2
                                        </Link>
                                        <Link to="/projects/p1/board">
                                            Go to p1
                                        </Link>
                                        <Link to="/projects">Leave board</Link>
                                    </div>
                                }
                            />
                            <Route
                                path="/projects"
                                element={<div>Project list</div>}
                            />
                        </Routes>
                    </AntdApp>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("CopilotDockHost", () => {
    let fetchMock: jest.SpyInstance<
        Promise<Response>,
        Parameters<typeof globalThis.fetch>
    >;

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockedUseAiChat.mockReturnValue(baseAiChat());
        mockedUseAgent.mockReturnValue(baseAgent());
        // Localstorage flag boardCopilot:enabled defaults true (see
        // useAiEnabled.ts) so AI is on for the harness. Reset between
        // tests so a previous test's writes don't leak.
        try {
            window.localStorage.clear();
        } catch {
            /* ignore */
        }
        fetchMock = jest.spyOn(globalThis, "fetch") as jest.SpyInstance<
            Promise<Response>,
            Parameters<typeof globalThis.fetch>
        >;
        fetchMock.mockReset();
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("users/members")) {
                return Promise.resolve(response([]));
            }
            // Project-scoped endpoints — strip the leading /api/v1
            // prefix and decide based on the endpoint segment + the
            // projectId in the query string.
            const params = new URL(url, "http://localhost").searchParams;
            const projectId = params.get("projectId") ?? "";
            if (url.includes("/projects")) {
                return Promise.resolve(
                    response(
                        project({
                            _id: projectId || "p1",
                            projectName:
                                projectId === "p2" ? "Roadmap 2" : "Roadmap"
                        })
                    )
                );
            }
            if (url.includes("/boards")) {
                return Promise.resolve(
                    response([
                        column({
                            _id: `column-${projectId}`,
                            projectId
                        })
                    ])
                );
            }
            if (url.includes("/tasks")) {
                return Promise.resolve(
                    response([
                        task({
                            _id: `task-${projectId}`,
                            projectId,
                            columnId: `column-${projectId}`,
                            taskName: `Task ${projectId.toUpperCase()}`
                        })
                    ])
                );
            }
            return Promise.resolve(response({}));
        });
    });

    afterEach(() => {
        fetchMock.mockRestore();
    });

    it("does not mount the dock surface when the URL is off-board (no projectId)", () => {
        renderHarness({ initialRoute: "/projects" });

        // The dock drawer is never mounted; the Bridge listener still
        // runs but it produces no DOM.
        expect(
            document.querySelector("[data-testid='copilot-dock']")
        ).toBeNull();
    });

    it("does not mount the dock when the dock is closed (open=false in Redux)", () => {
        renderHarness();

        // Initial dock state is closed (per-test reset above). The host
        // mounts but the CopilotDock's AntD Drawer doesn't paint its
        // contents until `open=true`.
        expect(
            document.querySelector("[data-testid='copilot-dock']")
        ).toBeNull();
    });

    it("survives a /projects/p1/board → /projects/p2/board navigation with open state + active tab intact", async () => {
        renderHarness();

        // Open the dock on the chat tab via the legacy bridge — the
        // chat-drawer Redux flag is the path every existing trigger
        // callsite already uses (CopilotMenu, copilot-landing, palette).
        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });

        // Dock paints, chat tab is selected.
        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });
        // The chat composer textarea is mounted (visible) when the chat
        // tab is active.
        const composer = await screen.findByRole("textbox", {
            name: /message board copilot/i
        });
        expect(composer).toBeInTheDocument();

        // Capture the actual DOM node so we can verify it does NOT
        // get torn down and rebuilt on route change.
        const composerNode = composer as HTMLTextAreaElement;
        fireEvent.change(composerNode, {
            target: { value: "remember me across projects" }
        });
        expect(composerNode.value).toBe("remember me across projects");

        // Switch project routes via a real navigation. The dock lives
        // ABOVE the routed Outlet so it must NOT unmount.
        fireEvent.click(screen.getByText("Go to p2"));

        await waitFor(() => {
            // Wait for the URL change to settle. The board route still
            // matches /projects/:projectId/board → both projects.
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });

        // The dock surface is still mounted.
        const dockAfter = document.querySelector(
            "[data-testid='copilot-dock']"
        );
        expect(dockAfter).not.toBeNull();

        // Open state survives.
        expect(store.getState().overlays.copilotDock.open).toBe(true);
        // Active tab is still "chat".
        expect(store.getState().overlays.copilotDock.activeTab).toBe("chat");

        // Most importantly: the composer is the SAME DOM node — the
        // body did not unmount. The textarea text must be intact.
        const composerStill = document.querySelector(
            "textarea[aria-label='Message Board Copilot']"
        ) as HTMLTextAreaElement | null;
        expect(composerStill).toBe(composerNode);
        expect(composerStill?.value).toBe("remember me across projects");
    });

    it("preserves the active tab when the user switched to Brief before navigating", async () => {
        renderHarness();

        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });

        // User flips to the Brief tab through the dock's tab control.
        // We dispatch directly because the controlled wrapper inside
        // the dock host calls `setActiveTab` for us when the tab is
        // clicked — emulating that dispatch here is equivalent and
        // doesn't require us to wait for the AntD Tabs animation.
        act(() => {
            store.dispatch(overlaysActions.setCopilotDockTab("brief"));
        });
        expect(store.getState().overlays.copilotDock.activeTab).toBe("brief");

        // Now navigate to a different project. Active tab must survive.
        fireEvent.click(screen.getByText("Go to p2"));
        await waitFor(() => {
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });

        expect(store.getState().overlays.copilotDock.activeTab).toBe("brief");
        // Dock is still open across the navigation.
        expect(store.getState().overlays.copilotDock.open).toBe(true);
    });

    it("closes the dock and the legacy chat/brief flags when the user dismisses it", async () => {
        renderHarness();

        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });

        // Click the mask to invoke the dock's onClose handler — that
        // path is wired by `ProjectScopedDock.handleClose` to flip the
        // dock state AND clear the legacy flags so the bridge doesn't
        // silently reopen on the next route change.
        const mask = document.querySelector(".ant-drawer-mask");
        expect(mask).not.toBeNull();
        fireEvent.click(mask as Element);

        await waitFor(() => {
            expect(store.getState().overlays.copilotDock.open).toBe(false);
        });
        expect(store.getState().overlays.chatDrawer.open).toBe(false);
        expect(store.getState().overlays.boardBriefOpen).toBe(false);
    });

    it("threads a command-palette prompt through to the dock state when openChatDrawer carries a pendingPrompt", async () => {
        renderHarness();

        act(() => {
            store.dispatch(
                overlaysActions.openChatDrawer({
                    pendingPrompt: "Summarize the board"
                })
            );
        });

        await waitFor(() => {
            expect(store.getState().overlays.copilotDock.open).toBe(true);
        });
        expect(store.getState().overlays.copilotDock.initialPrompt).toBe(
            "Summarize the board"
        );
        expect(store.getState().overlays.copilotDock.activeTab).toBe("chat");
    });
});
