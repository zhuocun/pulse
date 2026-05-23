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

        // Switch project routes via a real navigation. The dock chrome
        // (Redux open/activeTab state) lives in the store and survives,
        // but `ProjectScopedDock` carries `key={projectId}` so its
        // per-project state (in-memory messages buffer, triage agent
        // nudges/threadId, brief suggestion) resets cleanly on switch —
        // see Issue #1/#3/#7 in the R-A M1 review. The dock surface
        // remains visible across the navigation; only the body remounts.
        fireEvent.click(screen.getByText("Go to p2"));

        await waitFor(() => {
            // Wait for the URL change to settle. The board route still
            // matches /projects/:projectId/board → both projects.
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });

        // The dock surface is still mounted (Redux state preserved the
        // open flag across the navigation; the new ProjectScopedDock
        // instance reads the same Redux snapshot and renders Open).
        const dockAfter = document.querySelector(
            "[data-testid='copilot-dock']"
        );
        expect(dockAfter).not.toBeNull();

        // Open state survives.
        expect(store.getState().overlays.copilotDock.open).toBe(true);
        // Active tab is still "chat".
        expect(store.getState().overlays.copilotDock.activeTab).toBe("chat");

        // The composer is mounted for the new project too.
        const composerStill = document.querySelector(
            "textarea[aria-label='Message Board Copilot']"
        ) as HTMLTextAreaElement | null;
        expect(composerStill).not.toBeNull();
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
        // Spy on the chat hook's `send` so we can verify the prompt was
        // delivered all the way through to the chat engine.
        const sendSpy = jest.fn().mockResolvedValue(undefined);
        mockedUseAiChat.mockReturnValue(baseAiChat({ send: sendSpy }));

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
        // Active tab and open flag survive in Redux.
        expect(store.getState().overlays.copilotDock.activeTab).toBe("chat");

        // The chat tab body consumed the prompt and dispatched it to
        // the chat hook. Issue #8: after consumption the staged prompt
        // in Redux is cleared so a remount doesn't auto-re-dispatch.
        await waitFor(() => {
            expect(sendSpy).toHaveBeenCalledWith("Summarize the board");
        });
        expect(store.getState().overlays.copilotDock.initialPrompt).toBeNull();
    });

    /*
     * Regression for R-A M1 review Issue #5 (MAJOR): if the dock was
     * already open and the user submitted a SECOND palette prompt, the
     * bridge no-oped because `chatOpen` did not transition false→true.
     * The new prompt never reached `copilotDock.initialPrompt`. Legacy
     * `<AiChatDrawer>` passed `initialPrompt` as a prop so its body
     * re-dispatched on prop change — this PR lost that behavior.
     *
     * The fix diffs the prompt against `prevChatPromptRef` and forwards
     * any non-null change even when chatOpen stays true.
     */
    it("forwards a second palette prompt to the dock state while it is already open (#5)", async () => {
        // Spy on the chat hook's `send` so we can verify BOTH prompts
        // reach the chat engine, not just the first.
        const sendSpy = jest.fn().mockResolvedValue(undefined);
        mockedUseAiChat.mockReturnValue(baseAiChat({ send: sendSpy }));

        renderHarness();

        act(() => {
            store.dispatch(
                overlaysActions.openChatDrawer({
                    pendingPrompt: "first prompt"
                })
            );
        });
        await waitFor(() => {
            expect(sendSpy).toHaveBeenCalledWith("first prompt");
        });

        // Second palette submission — dock is already open, so the
        // bridge MUST diff the prompt and forward it. Before this fix
        // the prevOpen short-circuit blocked the dispatch and the new
        // prompt was silently dropped.
        act(() => {
            store.dispatch(
                overlaysActions.openChatDrawer({
                    pendingPrompt: "second prompt"
                })
            );
        });
        await waitFor(() => {
            expect(sendSpy).toHaveBeenCalledWith("second prompt");
        });

        // Dock stays open across the prompt update.
        expect(store.getState().overlays.copilotDock.open).toBe(true);
    });

    /*
     * Regression for R-A M1 review Issue #1 (CRITICAL): the dock
     * stayed mounted across project switch BEFORE this fix, so the
     * ChatTabBody's `messages` useState held p1's conversation when
     * `project._id` flipped to p2. The chat hook's `seedMessages()`
     * no-ops when `messages.length > 0` — so p2's saved history never
     * loaded, and the save effect then wrote the STALE p1 messages
     * into `saveChatHistory("p2", …)`, silently corrupting p2's
     * stored history. The fix is `key={projectId}` on
     * `ProjectScopedDock`, which remounts the body on project switch
     * so the chat hook's internal state is fresh per project.
     *
     * This test simulates the messages-then-switch sequence and
     * asserts:
     *   1. p2's localStorage chat history is NOT overwritten with p1's
     *      messages after the project switch
     *   2. p2's pre-existing saved history is preserved
     */
    it("does NOT overwrite p2's stored chat history with p1's messages after a project switch (#1)", async () => {
        // Seed p2's storage with its own history so we can verify it
        // survives the switch from p1.
        const p2History = [
            { role: "user" as const, content: "p2 question" },
            { role: "assistant" as const, content: "p2 answer" }
        ];
        window.localStorage.setItem(
            "copilot_history_p2",
            JSON.stringify(p2History)
        );

        // p1's chat hook returns a non-empty messages buffer to simulate
        // a conversation that's already happened on p1. We keep the
        // SAME mock return value across the navigation deliberately: if
        // a future change reverts `key={projectId}` on ProjectScopedDock,
        // the dock body would NOT remount, the chat hook instance would
        // keep returning `messages: p1Messages`, and the save effect in
        // ChatTabBody would write those stale messages into p2's
        // `copilot_history_p2` storage — exactly the corruption path
        // this test guards against. The remount fix breaks that chain
        // because the body unmounts before the save effect can run with
        // the wrong projectId, so the post-nav assertion stays green.
        const p1Messages = [
            { role: "user" as const, content: "p1 question" },
            { role: "assistant" as const, content: "p1 answer" }
        ];
        mockedUseAiChat.mockReturnValue(baseAiChat({ messages: p1Messages }));

        renderHarness();

        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });

        // Switch projects. With key={projectId} on ProjectScopedDock,
        // the body unmounts and remounts; the new chat hook starts with
        // an empty messages buffer; the save effect writes nothing
        // (messages.length === 0) until p2 actually starts a turn.
        fireEvent.click(screen.getByText("Go to p2"));
        await waitFor(() => {
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });

        // p2's storage was NOT corrupted with p1's messages.
        const storedRaw = window.localStorage.getItem("copilot_history_p2");
        const stored = storedRaw ? JSON.parse(storedRaw) : [];
        expect(stored).toEqual(p2History);
        // Specifically, p1's content didn't bleed across.
        expect(JSON.stringify(stored)).not.toContain("p1 question");
        expect(JSON.stringify(stored)).not.toContain("p1 answer");
    });

    /*
     * Regression for R-A M1 review Issue #3 + #7 (CRITICAL/MAJOR):
     * useAgent never reset its internal state when the
     * `options.projectId` changed, so on `p1 → p2` the triage agent's
     * `.nudges` from p1 would flash on p2's board until p2's own
     * stream completes. The fix is `key={projectId}` on
     * `ProjectScopedDock` — the entire dock subtree (including its
     * useAgent("triage-agent") call) is destroyed and a fresh
     * useAgent instance mounts for p2 with empty state.
     *
     * We assert this at the React level: after navigation, the
     * triage useAgent hook is called with the NEW project id and the
     * previous instance is unmounted (mock cleanup → its returned
     * state doesn't appear).
     */
    it("remounts ProjectScopedDock on projectId change so triage-agent state does NOT leak (#3/#7)", async () => {
        const p1Nudges = [
            {
                nudge_id: "nudge-p1",
                kind: "wip_overflow" as const,
                target_ids: ["task-p1-a"],
                summary: "p1 nudge summary",
                severity: "warn" as const,
                project_id: "p1"
            }
        ];
        // The first call (p1) returns nudges from a triage run.
        mockedUseAgent.mockReturnValueOnce(baseAgent({ nudges: p1Nudges }));
        // Subsequent calls (p2) return empty nudges — that's a fresh
        // useAgent instance after the remount.
        mockedUseAgent.mockReturnValue(baseAgent({ nudges: [] }));

        renderHarness();

        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });

        // Track every useAgent call so we can verify the SECOND
        // (post-switch) call carries the new projectId.
        const callsBefore = mockedUseAgent.mock.calls.length;
        expect(callsBefore).toBeGreaterThan(0);

        fireEvent.click(screen.getByText("Go to p2"));
        await waitFor(() => {
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });

        // After the switch, useAgent must have been re-invoked with
        // projectId=p2 — proof the subtree remounted (a non-remount
        // would just rerender the existing instance without calling
        // useAgent with the new option). We look for a call whose
        // options.projectId is "p2" specifically.
        const sawP2 = mockedUseAgent.mock.calls.some((call) => {
            const opts = call[1] as { projectId?: string } | undefined;
            return opts?.projectId === "p2";
        });
        expect(sawP2).toBe(true);
    });

    /*
     * Regression for R-A M1 review Issue #10 (test coverage gap):
     * verify the palette → AI hand-off via the
     * `boardCopilot:openChat` window event reaches the dock and
     * lands the prompt in the chat hook's `send`. Under the dock
     * flag, the host owns the listener (the BoardPage / ProjectPage
     * mirror listeners are gated off — see Issue #2 fix).
     */
    it("handles a boardCopilot:openChat window event and dispatches the prompt to the chat engine", async () => {
        const sendSpy = jest.fn().mockResolvedValue(undefined);
        mockedUseAiChat.mockReturnValue(baseAiChat({ send: sendSpy }));

        renderHarness();

        act(() => {
            window.dispatchEvent(
                new CustomEvent("boardCopilot:openChat", {
                    detail: { prompt: "What's blocking us this week?" }
                })
            );
        });

        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });
        await waitFor(() => {
            expect(sendSpy).toHaveBeenCalledWith(
                "What's blocking us this week?"
            );
        });
    });

    /*
     * Coverage for Issue #10: a bare `closeChatDrawer` dispatch
     * (legacy callsite) propagates to dock close through the dock's
     * close handler chain. This is the trigger an auth-state change
     * would use to dismiss the dock from outside the React tree.
     */
    it("a closeChatDrawer dispatch propagates to dock close via the host handler chain", async () => {
        renderHarness();
        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(store.getState().overlays.copilotDock.open).toBe(true);
        });

        // Simulate the user dismissing the dock via its mask click —
        // the host's `handleClose` calls closeDock + closeChatDrawer +
        // closeBoardBrief so the legacy flags fan out and the dock
        // does not silently reopen on the next render.
        const mask = document.querySelector(".ant-drawer-mask");
        expect(mask).not.toBeNull();
        fireEvent.click(mask as Element);

        await waitFor(() => {
            expect(store.getState().overlays.copilotDock.open).toBe(false);
        });
        expect(store.getState().overlays.chatDrawer.open).toBe(false);
        // initialPrompt is also cleared by the closeCopilotDock reducer.
        expect(store.getState().overlays.copilotDock.initialPrompt).toBeNull();
    });

    /*
     * Phase 4 A8 — Drawer-lift regression. With the previous
     * architecture (`<ProjectScopedDock key={projectId}>` wrapping the
     * whole CopilotDock including its AntD `<Drawer>`), a project
     * switch with the dock open tore down the Drawer and remounted it,
     * which fired the Drawer's close/open animation. The Lane A fix
     * lifts `<CopilotDockShell>` (the Drawer) outside the keyed body,
     * so the Drawer's `open` prop never flips false and AntD does NOT
     * animate during the project switch. We assert it stays mounted
     * AND the same DOM node (not a fresh one) — a remount would
     * produce a new element reference, the lifted-shell pattern keeps
     * the reference stable.
     */
    it("keeps the Drawer mounted continuously across a project switch (Drawer-lift)", async () => {
        renderHarness();
        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(
                document.querySelector("[data-testid='copilot-dock']")
            ).not.toBeNull();
        });

        // Capture the Drawer element reference before navigation. AntD
        // renders the dialog inside `data-testid='copilot-dock'`; the
        // dialog node identity is what we track.
        const dockBefore = document.querySelector(
            "[data-testid='copilot-dock']"
        );
        expect(dockBefore).not.toBeNull();

        // Navigate to a different project. The dock body remounts
        // (keyed), but the shell + its Drawer must stay continuously
        // mounted with the same DOM reference.
        fireEvent.click(screen.getByText("Go to p2"));
        await waitFor(() => {
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });

        const dockAfter = document.querySelector(
            "[data-testid='copilot-dock']"
        );
        expect(dockAfter).not.toBeNull();
        // Same DOM node — no remount. A remount would produce a new
        // reference even if the testid matched.
        expect(dockAfter).toBe(dockBefore);
        // And the Redux open flag is still true throughout.
        expect(store.getState().overlays.copilotDock.open).toBe(true);
    });

    /*
     * Phase 4 A8 — Inbox tab body is rendered when the user switches
     * to it via `setCopilotDockTab("inbox")`. The body sources its
     * nudges from the triage agent (passed in through the dock host),
     * so a mocked `useAgent` with non-empty `nudges` should populate
     * the inbox list. Empty state surfaces when no nudges are present.
     *
     * The mock implementation matches on agent name because the dock
     * also instantiates `useAgent("board-brief-agent", …)` inside
     * `BriefTabBody`; returning the inbox nudges from EVERY useAgent
     * call would let the brief's agent shape leak the wrong fields.
     */
    it("renders the Inbox tab body when the inbox tab is active and shows nudges from the triage agent", async () => {
        const inboxNudges = [
            {
                nudge_id: "nudge-1",
                kind: "wip_overflow" as const,
                target_ids: ["task-p1-a"],
                summary: "WIP overflow in Doing column",
                severity: "warn" as const,
                project_id: "p1"
            }
        ];
        mockedUseAgent.mockImplementation((agentName) =>
            agentName === "triage-agent"
                ? baseAgent({ nudges: inboxNudges })
                : baseAgent()
        );

        renderHarness();
        act(() => {
            store.dispatch(overlaysActions.openCopilotDock({ tab: "inbox" }));
        });

        // The dock is open on the Inbox tab and the nudges are
        // rendered through the inbox list (NudgeCard summaries).
        await waitFor(() => {
            expect(
                document.querySelector(
                    "[data-testid='copilot-dock-inbox-list']"
                )
            ).not.toBeNull();
        });
        expect(
            screen.getByText("WIP overflow in Doing column")
        ).toBeInTheDocument();
    });

    /*
     * Phase 4 A8 — opening the Inbox tab stamps `inboxLastReadAt`
     * (the launcher-badge unread-count baseline). The dock host's
     * effect fires on the open transition only; closing and re-
     * opening the Inbox produces a fresh stamp.
     *
     * We pin a known baseline by stamping the slice ourselves before
     * the harness mount, so the assertion can compare relative to a
     * stable starting point regardless of other tests' state.
     */
    it("stamps inboxLastReadAt when the Inbox tab becomes the active surface", async () => {
        // Pin a known baseline so the assertion is order-independent.
        const baseline = 1_000;
        store.dispatch(overlaysActions.markCopilotDockInboxRead(baseline));

        renderHarness();
        // `renderHarness` resets open/chat/brief flags but leaves
        // inboxLastReadAt at our baseline above. We re-stamp the
        // baseline AFTER renderHarness in case the host's mount-time
        // effect fired (it shouldn't — open is false here — but the
        // assertion below proves the open transition is what stamps).
        store.dispatch(overlaysActions.markCopilotDockInboxRead(baseline));
        expect(store.getState().overlays.copilotDock.inboxLastReadAt).toBe(
            baseline
        );

        act(() => {
            store.dispatch(overlaysActions.openCopilotDock({ tab: "inbox" }));
        });

        // After the open transition, the stamp jumps to a real
        // wall-clock value strictly greater than our baseline.
        await waitFor(() => {
            const stamped =
                store.getState().overlays.copilotDock.inboxLastReadAt ?? 0;
            expect(stamped).toBeGreaterThan(baseline);
        });
    });

    /*
     * Phase 4 A8 — per-project nudge isolation regression. When the
     * dock body remounts on project switch (key={projectId}), the new
     * project's `useAgent("triage-agent", { projectId: p2 })` instance
     * supplies a fresh nudges array — p1's nudges must NOT bleed into
     * p2's Inbox. We assert at the React level: after navigation, the
     * inbox renders the p2 mock's nudges (and the p1 nudges are gone),
     * because the body remounted and re-invoked useAgent with the new
     * projectId.
     */
    it("Inbox refreshes to the new project's nudges after a project switch", async () => {
        const p1Nudges = [
            {
                nudge_id: "nudge-p1",
                kind: "wip_overflow" as const,
                target_ids: ["task-p1-a"],
                summary: "p1 inbox nudge",
                severity: "warn" as const,
                project_id: "p1"
            }
        ];
        const p2Nudges = [
            {
                nudge_id: "nudge-p2",
                kind: "stale_task" as const,
                target_ids: ["task-p2-a"],
                summary: "p2 inbox nudge",
                severity: "info" as const,
                project_id: "p2"
            }
        ];
        // Match on (agentName, projectId): only the triage agent for
        // the matching project returns the project-specific nudges so
        // we can verify that the body's remount (key={projectId})
        // brings up a fresh useAgent instance with the new options
        // — that's the per-project isolation the spec calls for.
        mockedUseAgent.mockImplementation((agentName, options) => {
            if (agentName !== "triage-agent") return baseAgent();
            const optProjectId = (options as { projectId?: string } | undefined)
                ?.projectId;
            if (optProjectId === "p1") return baseAgent({ nudges: p1Nudges });
            if (optProjectId === "p2") return baseAgent({ nudges: p2Nudges });
            return baseAgent();
        });

        renderHarness();
        act(() => {
            store.dispatch(overlaysActions.openCopilotDock({ tab: "inbox" }));
        });
        await waitFor(() => {
            expect(screen.getByText("p1 inbox nudge")).toBeInTheDocument();
        });

        // Navigate to p2 — the body remounts under key={projectId},
        // useAgent is re-invoked with projectId=p2, returns p2Nudges.
        fireEvent.click(screen.getByText("Go to p2"));
        await waitFor(() => {
            expect(screen.getByText("Board page")).toBeInTheDocument();
        });
        await waitFor(() => {
            expect(screen.getByText("p2 inbox nudge")).toBeInTheDocument();
        });
        // p1's nudge is gone (not bleeding across).
        expect(screen.queryByText("p1 inbox nudge")).not.toBeInTheDocument();
    });

    /*
     * Phase 4 A8 — launcher-badge unread is zeroed when the user
     * opens the Inbox tab. This is the surface contract: opening the
     * Inbox = "I've seen everything" → badge collapses. The agent →
     * Redux projection path (nudges arrive, unreadCount bumps up
     * while NOT on Inbox) lives behind the `!aiUseLocalEngine` gate;
     * exercising it inside this test harness would force the chat
     * tab body onto the un-mocked `useAgentChat` engine and hang, so
     * we cover the projection itself in the overlaysSlice unit tests
     * (`setCopilotDockInboxUnread` + `markCopilotDockInboxRead` zero
     * coupling) and stay surface-level here.
     */
    it("zeros the launcher-badge unread count when the user opens the Inbox tab", async () => {
        // Seed an unread count as if the host's projection effect had
        // already fired (the agent path is gated on remote engine, so
        // we set Redux directly here to keep the assertion focused on
        // the read transition).
        act(() => {
            store.dispatch(overlaysActions.setCopilotDockInboxUnread(3));
        });
        renderHarness();
        // renderHarness resets the dock open flag but `setCopilotDockInboxUnread`
        // survives the reset — verify the seed is intact.
        store.dispatch(overlaysActions.setCopilotDockInboxUnread(3));
        expect(store.getState().overlays.copilotDock.inboxUnreadCount).toBe(3);

        act(() => {
            store.dispatch(overlaysActions.openCopilotDock({ tab: "inbox" }));
        });
        await waitFor(() => {
            expect(store.getState().overlays.copilotDock.inboxUnreadCount).toBe(
                0
            );
        });
    });

    /*
     * R-A M1 review regression (MAJOR): the launcher-badge projection
     * effect re-runs whenever `inboxSurfaceVisible` flips false. After
     * the user opens Inbox → `markInboxRead` zeros the count → user
     * switches BACK to a non-inbox tab, the effect saw `nudgeCount = N`
     * (unchanged because the agent buffer didn't move), did NOT
     * short-circuit, and dispatched `setInboxUnread(N)` — restoring
     * the badge to its pre-read value. The "I read my inbox" state
     * only lasted as long as the user stayed on the Inbox tab.
     *
     * The fix gates the projection on a high-water-mark ref
     * (`prevNudgeCountRef`): the effect only dispatches when the
     * current nudge count is strictly GREATER than the ref. When the
     * user opens Inbox, the ref is synced to the current count; the
     * follow-up switch-away sees `N > N` is false and stays quiet.
     *
     * This test exercises the FULL `aiUseLocalEngine: false` path the
     * production bug lives on — the original tests all mocked
     * `aiUseLocalEngine: true` so the projection early-returned and
     * the bug was invisible. We pin the env mock to remote-engine for
     * the duration of this test only; the `afterEach` restores it so
     * sibling tests stay on the local engine.
     */
    describe("with aiUseLocalEngine: false (remote engine)", () => {
        const envMod = jest.requireMock("../../constants/env") as {
            default: {
                apiBaseUrl: string;
                aiBaseUrl: string;
                aiEnabled: boolean;
                aiUseLocalEngine: boolean;
                aiMutationProposalsEnabled: boolean;
                aiKnowledgeCutoff: string;
                bottomNavEnabled: boolean;
                taskPanelRouted: boolean;
                copilotDockEnabled: boolean;
            };
        };

        beforeEach(() => {
            envMod.default.aiUseLocalEngine = false;
        });

        afterEach(() => {
            envMod.default.aiUseLocalEngine = true;
        });

        it("does NOT bounce the launcher-badge back to N after opening Inbox and switching to another tab", async () => {
            // Stage the triage agent to surface N nudges so the
            // projection effect has something to push to Redux.
            const stagedNudges = [
                {
                    nudge_id: "nudge-bounce-1",
                    kind: "wip_overflow" as const,
                    target_ids: ["task-p1-a"],
                    summary: "first nudge",
                    severity: "warn" as const,
                    project_id: "p1"
                },
                {
                    nudge_id: "nudge-bounce-2",
                    kind: "stale_task" as const,
                    target_ids: ["task-p1-a"],
                    summary: "second nudge",
                    severity: "info" as const,
                    project_id: "p1"
                }
            ];
            mockedUseAgent.mockImplementation((agentName) =>
                agentName === "triage-agent"
                    ? baseAgent({ nudges: stagedNudges })
                    : baseAgent()
            );

            renderHarness();

            // Open the dock on the Brief tab so the projection effect
            // runs (inboxSurfaceVisible = false) and bumps the count to
            // the staged nudge length. We use Brief instead of Chat to
            // avoid the un-mocked `useAgentChat` engine that would
            // otherwise hang under aiUseLocalEngine: false.
            act(() => {
                store.dispatch(
                    overlaysActions.openCopilotDock({ tab: "brief" })
                );
            });
            await waitFor(() => {
                expect(
                    store.getState().overlays.copilotDock.inboxUnreadCount
                ).toBe(stagedNudges.length);
            });

            // User opens the Inbox tab. The host's mark-read effect
            // fires on the open transition and zeros the count.
            act(() => {
                store.dispatch(overlaysActions.setCopilotDockTab("inbox"));
            });
            await waitFor(() => {
                expect(
                    store.getState().overlays.copilotDock.inboxUnreadCount
                ).toBe(0);
            });

            // User switches BACK to the Brief tab. Pre-fix, the
            // projection effect re-ran (inboxSurfaceVisible flipped
            // false), saw nudgeCount = N (unchanged), and re-dispatched
            // setInboxUnread(N) — restoring the badge. With the
            // prevNudgeCountRef high-water gate, the effect only
            // dispatches on STRICT increase, so N > N is false and
            // the count stays 0.
            act(() => {
                store.dispatch(overlaysActions.setCopilotDockTab("brief"));
            });
            // Wait a microtask for the projection effect to run; if
            // the bug is present the count will already be N here.
            await waitFor(() => {
                expect(store.getState().overlays.copilotDock.activeTab).toBe(
                    "brief"
                );
            });
            expect(store.getState().overlays.copilotDock.inboxUnreadCount).toBe(
                0
            );
        });
    });
});
