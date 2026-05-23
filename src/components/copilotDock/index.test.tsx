import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";

// Mock the hooks the dock bodies pull in so tab-switch tests can spy on
// `abort` / `start` directly. Default `mockReturnValue` shapes are
// applied in `beforeEach` so the dock-level tests above (which don't
// drive hook behavior) keep working with the safe defaults.
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

import CopilotDock, { type CopilotDockTab } from ".";

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

/*
 * CopilotDock — Phase 3 A1.
 *
 * The dock is a tabbed shell hosting `ChatTabBody` + `BriefTabBody`.
 * These tests cover the dock's own contract (tab switch, placement,
 * dirty-state-safe close, header consolidation). The individual
 * bodies have their own coverage via the legacy drawer tests; here
 * we only assert dock-level behavior.
 */

const installAntdBrowserMocks = (matchCoarse = false) => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: matchCoarse && query === "(pointer: coarse)",
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

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    index: 0,
    projectId: "project-1",
    ...overrides
});

interface RenderOptions {
    open?: boolean;
    activeTab?: CopilotDockTab;
    onClose?: () => void;
    onTabChange?: (tab: CopilotDockTab) => void;
}

const renderDock = (options: RenderOptions = {}) => {
    const onClose = options.onClose ?? jest.fn();
    const onTabChange = options.onTabChange ?? jest.fn();
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    const utils = render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AntdApp>
                        <CopilotDock
                            activeTab={options.activeTab ?? "chat"}
                            columns={[column()]}
                            knownProjectIds={["project-1"]}
                            members={[member()]}
                            onClose={onClose}
                            onTabChange={onTabChange}
                            open={options.open ?? true}
                            project={project()}
                            tasks={[]}
                        />
                    </AntdApp>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return { ...utils, onClose, onTabChange };
};

/**
 * Tests that exercise tab-switch behavior need the parent to actually
 * apply `onTabChange` so the dock re-renders with the new `activeTab`.
 * `renderDock` (above) passes a `jest.fn()`, which catches the call but
 * never updates state — that's fine for the lower-level assertions but
 * useless for "type in Chat → switch to Brief → switch back". This
 * controlled wrapper threads the tab through real React state. The
 * `tasks` prop is also controlled so a test can mutate it mid-session
 * (e.g. simulate a board mutation while the user is on the Chat tab).
 */
interface ControlledDockProps {
    initialTab?: CopilotDockTab;
    initialOpen?: boolean;
    initialTasks?: ITask[];
    /**
     * Exposes the internal `setTasks` setter so a test can simulate a
     * board mutation (fingerprint change) from outside React's tree.
     */
    onMount?: (controls: {
        setTasks: React.Dispatch<React.SetStateAction<ITask[]>>;
    }) => void;
}

const ControlledDock: React.FC<ControlledDockProps> = ({
    initialTab = "chat",
    initialOpen = true,
    initialTasks = [],
    onMount
}) => {
    const [activeTab, setActiveTab] = useState<CopilotDockTab>(initialTab);
    const [open, setOpen] = useState(initialOpen);
    const [tasks, setTasks] = useState<ITask[]>(initialTasks);
    // Surface setTasks once so the test can mutate the fingerprint.
    const onMountRef = useRef(onMount);
    onMountRef.current = onMount;
    const surfaced = useRef(false);
    useEffect(() => {
        if (surfaced.current) return;
        surfaced.current = true;
        onMountRef.current?.({ setTasks });
    }, []);
    return (
        <CopilotDock
            activeTab={activeTab}
            columns={[column()]}
            knownProjectIds={["project-1"]}
            members={[member()]}
            onClose={() => setOpen(false)}
            onTabChange={setActiveTab}
            open={open}
            project={project()}
            tasks={tasks}
        />
    );
};

const renderControlled = (
    props: ControlledDockProps = {}
): ReturnType<typeof render> => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AntdApp>
                        <ControlledDock {...props} />
                    </AntdApp>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("CopilotDock", () => {
    beforeEach(() => {
        installAntdBrowserMocks(false);
        // Safe default mock returns so existing dock-level assertions
        // (which don't care about hook internals) keep passing. Tests
        // that DO drive hook behavior override these via mockReturnValue.
        mockedUseAiChat.mockReturnValue(baseAiChat());
        mockedUseAgent.mockReturnValue(baseAgent());
    });

    it("renders the dock with both Chat and Brief tabs visible", () => {
        renderDock({ activeTab: "chat" });

        const tabList = screen.getByRole("tablist");
        expect(tabList).toBeInTheDocument();
        expect(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabChat as string
            })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabBrief as string
            })
        ).toBeInTheDocument();
    });

    it("invokes onTabChange when the user activates the Brief tab", async () => {
        const onTabChange = jest.fn();
        renderDock({ activeTab: "chat", onTabChange });

        const briefTab = screen.getByRole("tab", {
            name: microcopy.copilotDock.tabBrief as string
        });
        fireEvent.click(briefTab);

        await waitFor(() => {
            expect(onTabChange).toHaveBeenCalledWith("brief");
        });
    });

    it("renders the chat composer when the Chat tab is active", async () => {
        renderDock({ activeTab: "chat" });

        // The composer textarea advertises itself via the
        // "Message Board Copilot" aria-label.
        const composer = await screen.findByRole("textbox", {
            name: /message board copilot/i
        });
        expect(composer).toBeInTheDocument();
    });

    it("mounts as a right-placement drawer on desktop/tablet (default jsdom mocks)", () => {
        renderDock();

        const dock = document.querySelector("[data-testid='copilot-dock']");
        expect(dock).not.toBeNull();
        // Public placement attribute mirrors TaskDetailPanel's pattern —
        // we don't couple to AntD's private `.ant-drawer-*` classes.
        expect(dock?.getAttribute("data-placement")).toBe("right");
    });

    it("mounts as a bottom-sheet on coarse-pointer phone viewports", async () => {
        installAntdBrowserMocks(true);
        renderDock();

        await waitFor(() => {
            const dock = document.querySelector("[data-testid='copilot-dock']");
            expect(dock?.getAttribute("data-placement")).toBe("bottom");
        });
    });

    it("renders a single consolidated header (exactly one AI badge in the dock header)", () => {
        renderDock();

        // The dock title row owns exactly one ai-badge tag. Both legacy
        // drawers used to render their own; the dock's role is to
        // collapse them onto a single header.
        //
        // ChatTabBody's per-message disclaimer ALSO renders the
        // `microcopy.a11y.aiBadge` string, so a global text count can
        // exceed one without telling us anything about the header.
        // Scope the assertion to the AntD drawer header region so we
        // count badges that actually live in the dock title row only.
        const header = document.querySelector(
            "[data-testid='copilot-dock'] .ant-drawer-header"
        );
        expect(header).not.toBeNull();
        const headerBadgeMatches = (header as HTMLElement).querySelectorAll(
            ".ant-tag"
        );
        const headerAiBadges = Array.from(headerBadgeMatches).filter((node) =>
            (node.textContent ?? "").includes(microcopy.a11y.aiBadge as string)
        );
        expect(headerAiBadges).toHaveLength(1);
    });

    it("invokes onClose when the mask is clicked (dirty-state-safe close)", () => {
        const onClose = jest.fn();
        renderDock({ onClose });

        const mask = document.querySelector(".ant-drawer-mask");
        expect(mask).not.toBeNull();
        fireEvent.click(mask as Element);
        expect(onClose).toHaveBeenCalled();
    });

    it("invokes onClose when Escape is pressed at the dock surface", () => {
        const onClose = jest.fn();
        renderDock({ onClose });

        // AntD Drawer listens for Esc on the dialog content; firing
        // keyDown from the document level reliably triggers the close.
        fireEvent.keyDown(document.body, {
            key: "Escape",
            code: "Escape"
        });
        expect(onClose).toHaveBeenCalled();
    });

    it("does not mount the drawer surface when open=false", () => {
        renderDock({ open: false });

        // When closed, AntD does not render the dialog content into the
        // DOM (it animates back to a hidden state). The test root will
        // not show the tablist or the composer.
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    /*
     * R1-H1 regression: switching from Chat → Brief used to clear the
     * composer text AND abort any in-flight stream because the body's
     * teardown effect watched a single `open` prop that was passed as
     * `dockOpen && activeTab === "chat"`. After the prop split, the body
     * stays mounted across tab switches; composer text + in-flight
     * stream must survive a round-trip to the Brief tab.
     *
     * Extended (R-A L1): also asserts `abort` is NOT called when a
     * stream is in flight at the time of the tab switch — covers the
     * "I asked Copilot something, opened Brief to check workload, came
     * back, my answer is still streaming" flow the contract requires.
     */
    it("preserves chat composer text + in-flight stream across a Chat → Brief → Chat tab switch (R1-H1)", async () => {
        const abort = jest.fn();
        // Simulate a stream in flight so the close-side teardown wired
        // to `dockOpen` (NOT `tabActive`) would be the only thing that
        // could abort it. A tab switch must leave it alone.
        mockedUseAiChat.mockReturnValue(
            baseAiChat({ abort, isLoading: true, streamingText: "Working…" })
        );
        renderControlled({ initialTab: "chat" });

        const composer = (await screen.findByRole("textbox", {
            name: /message board copilot/i
        })) as HTMLTextAreaElement;
        fireEvent.change(composer, { target: { value: "hello copilot" } });
        expect(composer.value).toBe("hello copilot");
        // Sanity: abort hasn't fired during render / typing.
        expect(abort).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabBrief as string
            })
        );

        // After the switch, AntD keeps the Chat panel mounted (it just
        // hides its visibility). The textarea node is still in the DOM
        // and its value MUST be preserved.
        await waitFor(() => {
            expect(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabBrief as string,
                    selected: true
                })
            ).toBeInTheDocument();
        });
        // Same composer node, queried by ID since visibility may have
        // changed how queries resolve. Use a direct DOM query because
        // the hidden panel is excluded from name-based queries.
        const composerAfter = document.querySelector(
            "textarea[aria-label='Message Board Copilot']"
        ) as HTMLTextAreaElement | null;
        expect(composerAfter).not.toBeNull();
        expect(composerAfter!.value).toBe("hello copilot");
        // The actual R1-H1 invariant: tab switch must NOT tear down the
        // in-flight stream. Body stays mounted, abort stays untouched.
        expect(abort).not.toHaveBeenCalled();

        // Switching back to Chat re-shows the same composer with the
        // text intact.
        fireEvent.click(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabChat as string
            })
        );
        await waitFor(() => {
            const composerVisible = screen.getByRole("textbox", {
                name: /message board copilot/i
            }) as HTMLTextAreaElement;
            expect(composerVisible.value).toBe("hello copilot");
        });
        // Round-trip complete; the stream is still flagged in-flight
        // and abort was never fired.
        expect(abort).not.toHaveBeenCalled();
    });

    /*
     * R1-H2 regression: the Brief body's `useEffect([open])` used to fire
     * `track(COPILOT_BRIEF_OPEN)` every time `open` flipped, including on
     * tab switches that re-show the tab without any underlying state
     * change. After the prop split, the analytics event must fire ONCE
     * for an "open → tab Chat → tab Brief" round-trip — the user has not
     * re-opened the brief surface from scratch.
     */
    it("only fires COPILOT_BRIEF_OPEN once across a Brief → Chat → Brief round-trip (R1-H2)", async () => {
        const sink = jest.fn<
            ReturnType<AnalyticsSink>,
            Parameters<AnalyticsSink>
        >();
        const previous = setAnalyticsSink(sink);
        try {
            renderControlled({ initialTab: "brief" });

            // Wait for the brief tab to render so its mount-effect has
            // run at least once.
            await waitFor(() => {
                expect(
                    screen.getByRole("tab", {
                        name: microcopy.copilotDock.tabBrief as string,
                        selected: true
                    })
                ).toBeInTheDocument();
            });
            const initialBriefOpenCount = sink.mock.calls.filter(
                ([event]) => event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
            ).length;
            expect(initialBriefOpenCount).toBe(1);

            // Switch to Chat, then back to Brief. Same fingerprint, same
            // surface state — the event must NOT fire a second time just
            // because the user toggled tabs.
            fireEvent.click(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabChat as string
                })
            );
            await waitFor(() => {
                expect(
                    screen.getByRole("tab", {
                        name: microcopy.copilotDock.tabChat as string,
                        selected: true
                    })
                ).toBeInTheDocument();
            });

            fireEvent.click(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabBrief as string
                })
            );
            await waitFor(() => {
                expect(
                    screen.getByRole("tab", {
                        name: microcopy.copilotDock.tabBrief as string,
                        selected: true
                    })
                ).toBeInTheDocument();
            });

            const finalBriefOpenCount = sink.mock.calls.filter(
                ([event]) => event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
            ).length;
            expect(finalBriefOpenCount).toBe(1);
        } finally {
            setAnalyticsSink(previous);
        }
    });

    /*
     * R-A H2 fix: mid-session board mutations that change the brief's
     * fingerprint while the user is on the Chat tab must surface a
     * distinct `BRIEF_REFRESHED_BY_BOARD_CHANGE` signal (not a second
     * COPILOT_BRIEF_OPEN). Open-rate metrics must not be inflated by
     * refetches caused by board state drift.
     */
    it("fires BRIEF_REFRESHED_BY_BOARD_CHANGE (not BRIEF_OPEN) when the fingerprint changes mid-tab-away", async () => {
        const sink = jest.fn<
            ReturnType<AnalyticsSink>,
            Parameters<AnalyticsSink>
        >();
        const previous = setAnalyticsSink(sink);
        let controls: {
            setTasks: React.Dispatch<React.SetStateAction<ITask[]>>;
        } | null = null;
        try {
            renderControlled({
                initialTab: "brief",
                onMount: (c) => {
                    controls = c;
                }
            });
            await waitFor(() => {
                expect(
                    screen.getByRole("tab", {
                        name: microcopy.copilotDock.tabBrief as string,
                        selected: true
                    })
                ).toBeInTheDocument();
            });
            // First-open BRIEF_OPEN should have fired exactly once.
            expect(
                sink.mock.calls.filter(
                    ([event]) => event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                )
            ).toHaveLength(1);

            // Switch to Chat so `surfaceVisible` flips false on the brief
            // body — the user is no longer looking at the brief.
            fireEvent.click(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabChat as string
                })
            );
            await waitFor(() => {
                expect(
                    screen.getByRole("tab", {
                        name: microcopy.copilotDock.tabChat as string,
                        selected: true
                    })
                ).toBeInTheDocument();
            });

            // Simulate a board mutation: add a task while the user is on
            // Chat. This bumps the fingerprint without touching the dock.
            act(() => {
                controls!.setTasks([
                    {
                        _id: "task-new",
                        columnId: "column-1",
                        coordinatorId: "member-1",
                        epic: "x",
                        index: 0,
                        note: "",
                        projectId: "project-1",
                        storyPoints: 2,
                        taskName: "Mid-session add",
                        type: "Task"
                    }
                ]);
            });

            // Switch back to Brief — the body sees a new fingerprint and
            // must refetch under the distinct refresh event.
            fireEvent.click(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabBrief as string
                })
            );
            await waitFor(() => {
                expect(
                    screen.getByRole("tab", {
                        name: microcopy.copilotDock.tabBrief as string,
                        selected: true
                    })
                ).toBeInTheDocument();
            });

            await waitFor(() => {
                expect(
                    sink.mock.calls.filter(
                        ([event]) =>
                            event ===
                            ANALYTICS_EVENTS.BRIEF_REFRESHED_BY_BOARD_CHANGE
                    )
                ).toHaveLength(1);
            });

            // BRIEF_OPEN must still be at 1 — the surface was never closed
            // and re-opened, only the underlying data drifted.
            expect(
                sink.mock.calls.filter(
                    ([event]) => event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                )
            ).toHaveLength(1);
        } finally {
            setAnalyticsSink(previous);
        }
    });
});
