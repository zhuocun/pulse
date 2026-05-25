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

import CopilotDock, { CopilotDockShell, type CopilotDockTab } from ".";

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

        // Phase 6 Wave 3 — the dock now renders through the Sheet
        // primitive. On non-coarse-pointer (desktop/tablet) Sheet falls
        // back to an AntD `<Drawer placement={desktopPlacement}>`, which
        // ships the `.ant-drawer-right` class. Assert via the class so
        // the test stays decoupled from the Sheet's internal data-attr
        // forwarding policy.
        const dock = document.querySelector("[data-testid='copilot-dock']");
        expect(dock).not.toBeNull();
        expect(document.querySelector(".ant-drawer-right")).not.toBeNull();
    });

    it("mounts as a multi-detent Sheet on coarse-pointer phone viewports", async () => {
        installAntdBrowserMocks(true);
        renderDock();

        // Phase 6 Wave 3 — phone branch now goes through the Sheet's
        // animated multi-detent surface. The Sheet emits a
        // `${data-testid}-surface` node carrying the active detent in
        // `data-detent`; the dock's `defaultDetent="large"` so the
        // initial detent is large.
        await waitFor(() => {
            const surface = screen.getByTestId("copilot-dock-surface");
            expect(surface).toBeInTheDocument();
            expect(surface).toHaveAttribute("data-detent", "large");
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
        // Scope the assertion to the dock header by querying the title
        // element by its id (`copilot-dock-title`) and walking up to the
        // enclosing AntD drawer header — the desktop branch still uses
        // the AntD `<Drawer>` fallback under the Sheet primitive so the
        // `.ant-drawer-header` selector is still valid on this branch.
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

    it("invokes onClose when the mask is clicked on desktop (dirty-state-safe close)", () => {
        const onClose = jest.fn();
        renderDock({ onClose });

        // Desktop branch uses the AntD Drawer fallback (the Sheet's
        // non-animated path), so the dismiss surface is the AntD mask
        // class — same selector as before the Sheet migration.
        const mask = document.querySelector(".ant-drawer-mask");
        expect(mask).not.toBeNull();
        fireEvent.click(mask as Element);
        expect(onClose).toHaveBeenCalled();
    });

    it("invokes onClose when the scrim is clicked on phone chrome", async () => {
        installAntdBrowserMocks(true);
        const onClose = jest.fn();
        renderDock({ onClose });

        // Phase 6 Wave 3 — phone branch goes through the Sheet's
        // animated surface, which emits a scrim with the suffixed
        // `${data-testid}-scrim` id. Clicking it must invoke the same
        // `onClose` callback the AntD mask click used to fire.
        const scrim = await screen.findByTestId("copilot-dock-scrim");
        fireEvent.click(scrim);
        expect(onClose).toHaveBeenCalled();
    });

    it("invokes onClose when Escape is pressed at the dock surface", () => {
        const onClose = jest.fn();
        renderDock({ onClose });

        // AntD Drawer (desktop) listens for Esc on the dialog content;
        // firing keyDown from the document level reliably triggers the
        // close. The Sheet's animated branch also listens for Escape at
        // the window level, so the same fireEvent works on phone too.
        fireEvent.keyDown(document.body, {
            key: "Escape",
            code: "Escape"
        });
        expect(onClose).toHaveBeenCalled();
    });

    it("does not mount the drawer surface when open=false", () => {
        renderDock({ open: false });

        // When closed, neither Sheet branch renders the surface body
        // into the DOM. The test root will not show the tablist or the
        // composer.
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("forwards aria-labelledby to the AntD Drawer fallback on desktop", () => {
        renderDock();

        // Sheet's P1.1 fix forwards the consumer-supplied
        // `aria-labelledby` to the underlying AntD Drawer fallback so
        // the desktop dialog keeps its accessible name. The dock's only
        // accessible-name carrier is the title element; the labelledby
        // wiring is what surfaces it to AT. The rc-drawer panel renders
        // a `role="dialog"` with the consumer's `aria-labelledby`
        // picked off the props via `pickAttrs({ aria: true })`.
        const dialog = document.querySelector("[role='dialog']");
        expect(dialog).not.toBeNull();
        expect(dialog?.getAttribute("aria-labelledby")).toBe(
            "copilot-dock-title"
        );
        // Title id appears exactly once in the DOM (no duplicate id
        // from the Sheet's own title-slot wrapper — Sheet's P1.2 fix
        // skips stamping the id when the consumer supplies their own
        // `ariaLabelledBy`).
        const titleNodes = document.querySelectorAll("#copilot-dock-title");
        expect(titleNodes).toHaveLength(1);
    });

    it("forwards aria-labelledby to the animated surface on phone chrome", async () => {
        installAntdBrowserMocks(true);
        renderDock();

        // Phase 6 Wave 3 — phone branch animated surface must carry the
        // same aria-labelledby attribute pointing at the consumer-owned
        // title node. No duplicate id either.
        const surface = await screen.findByTestId("copilot-dock-surface");
        expect(surface.getAttribute("aria-labelledby")).toBe(
            "copilot-dock-title"
        );
        const titleNodes = document.querySelectorAll("#copilot-dock-title");
        expect(titleNodes).toHaveLength(1);
    });

    /*
     * Phase 4 A8 / Wave 3 — the host pattern is `<CopilotDockShell
     * open={open}>{<ProjectScopedDockBody key={projectId} />}</...>`.
     * The shell stays mounted across project switches; only the body
     * remounts via the key. Migrating to Sheet must not break that
     * contract — the surface DOM identity must persist, and `onClose`
     * MUST NOT fire on a child key change.
     */
    it("keeps the shell surface mounted when keyed children remount across projectId changes", async () => {
        installAntdBrowserMocks(true);
        const onClose = jest.fn();
        const ShellHarness: React.FC<{ projectId: string }> = ({
            projectId
        }) => (
            <CopilotDockShell onClose={onClose} open>
                <div data-testid="dock-body-key" key={projectId}>
                    {projectId}
                </div>
            </CopilotDockShell>
        );
        const { rerender } = render(
            <Provider store={store}>
                <AntdApp>
                    <ShellHarness projectId="p1" />
                </AntdApp>
            </Provider>
        );
        const surfaceBefore = await screen.findByTestId("copilot-dock-surface");
        expect(screen.getByTestId("dock-body-key").textContent).toBe("p1");

        rerender(
            <Provider store={store}>
                <AntdApp>
                    <ShellHarness projectId="p2" />
                </AntdApp>
            </Provider>
        );
        const surfaceAfter = await screen.findByTestId("copilot-dock-surface");
        // The surface element identity is preserved across the keyed
        // child remount — the Sheet doesn't tear down and re-create the
        // animated portal in response to the inner `key` change.
        expect(surfaceAfter).toBe(surfaceBefore);
        expect(screen.getByTestId("dock-body-key").textContent).toBe("p2");
        expect(onClose).not.toHaveBeenCalled();
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

    /*
     * R-A M3 — the fingerprint-driven refetch used to fire on EVERY board
     * change (drag, inline edit, task add) while the brief tab was open.
     * In a hot edit session that meant 5+ provider calls per minute for
     * no incremental insight. The min-interval guard collapses consecutive
     * fingerprint bumps into a single refetch within the window, with a
     * trailing-edge timer so the final state still lands once stable.
     *
     * Tests use fake timers + the BRIEF_REFRESHED_BY_BOARD_CHANGE analytics
     * counter as a proxy for "refetch actually fired" — that event is the
     * single emit point in the gated branch, so 1:1 with refetches.
     */
    describe("R-A M3 — fingerprint-driven refetch debounce", () => {
        const countRefreshes = (
            sink: jest.MockedFunction<AnalyticsSink>
        ): number =>
            sink.mock.calls.filter(
                ([event]) =>
                    event === ANALYTICS_EVENTS.BRIEF_REFRESHED_BY_BOARD_CHANGE
            ).length;

        const newTask = (suffix: string): ITask => ({
            _id: `task-${suffix}`,
            columnId: "column-1",
            coordinatorId: "member-1",
            epic: "x",
            index: 0,
            note: "",
            projectId: "project-1",
            storyPoints: 2,
            taskName: `Mid-session ${suffix}`,
            type: "Task"
        });

        beforeEach(() => {
            // Fake timers must be installed BEFORE rendering so the brief
            // body's setTimeout / setInterval calls bind to the mocked
            // clock. Jest 30 also mocks `Date.now`, which is critical
            // here — the gate compares `Date.now()` against the stored
            // last-refresh timestamp, so real-clock leakage would let
            // tiny elapsed times slip past the gate.
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        /**
         * Helper to mutate task state from outside React's tree, then
         * flush microtasks so React commits the resulting effect/setState
         * pairs before assertions land. Without the trailing `await
         * Promise.resolve()`, the local engine's `run()` (which begins
         * with `await Promise.resolve(...)`) leaks an "update not
         * wrapped in act" warning into the test output.
         */
        const mutateTasks = async (
            controls: {
                setTasks: React.Dispatch<React.SetStateAction<ITask[]>>;
            },
            tasks: ITask[]
        ): Promise<void> => {
            await act(async () => {
                controls.setTasks(tasks);
                await Promise.resolve();
            });
        };

        const advanceBy = async (ms: number): Promise<void> => {
            await act(async () => {
                jest.advanceTimersByTime(ms);
                await Promise.resolve();
            });
        };

        it("collapses rapid fingerprint changes within MIN_INTERVAL into a single refetch + analytics event", async () => {
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

                // Wait for the brief body to mount + fire the first-open
                // analytics. After first-open, lastAutoRefreshAt is still
                // the initial 0, so the FIRST subsequent fingerprint
                // change fires immediately (instant feedback contract).
                await waitFor(() => {
                    expect(
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });
                expect(countRefreshes(sink)).toBe(0);

                // First fingerprint change — fires immediately (uses up
                // the "instant feedback" credit, sets the gate baseline).
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // Four rapid follow-ups within 10s — each within the
                // MIN_INTERVAL window, so the gate blocks the immediate
                // refetch and replaces the trailing timer each time. No
                // additional refetch fires until the gate clears.
                await advanceBy(2_000);
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                await advanceBy(2_000);
                await mutateTasks(controls!, [
                    newTask("1"),
                    newTask("2"),
                    newTask("3")
                ]);
                await advanceBy(2_000);
                await mutateTasks(controls!, [
                    newTask("1"),
                    newTask("2"),
                    newTask("3"),
                    newTask("4")
                ]);
                await advanceBy(2_000);
                await mutateTasks(controls!, [
                    newTask("1"),
                    newTask("2"),
                    newTask("3"),
                    newTask("4"),
                    newTask("5")
                ]);

                // 8s elapsed since the first refetch — still inside the
                // 30s gate, so the count is still exactly 1.
                expect(countRefreshes(sink)).toBe(1);
            } finally {
                setAnalyticsSink(previous);
            }
        });

        it("fires immediately when a fingerprint change arrives after the MIN_INTERVAL window clears", async () => {
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
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });

                // First fingerprint change fires immediately and sets
                // the gate baseline.
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // Wait past the gate, with no intervening changes. No
                // trailing timer should fire here — it was never armed.
                await advanceBy(31_000);
                expect(countRefreshes(sink)).toBe(1);

                // A change AFTER the gate fires immediately (not via a
                // trailing timer). This proves the gate is non-sticky:
                // a stable period followed by a fresh edit gets instant
                // feedback again.
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                expect(countRefreshes(sink)).toBe(2);
            } finally {
                setAnalyticsSink(previous);
            }
        });

        it("fires a trailing-edge refetch after the gate clears when a change landed mid-gate", async () => {
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
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });

                // First change — fires immediately, gate now armed.
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // Second change 5s into the gate — schedules a trailing
                // refetch for the remaining 25s. NOT an immediate fire.
                await advanceBy(5_000);
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                expect(countRefreshes(sink)).toBe(1);

                // Advance to just before the trailing timer would fire
                // (24s of the remaining 25s). Still 1 — proves the gate
                // really is timer-driven and not "next change unblocks".
                await advanceBy(24_000);
                expect(countRefreshes(sink)).toBe(1);

                // Cross the trailing-edge boundary. The deferred refetch
                // now lands as the second analytics event of the run.
                await advanceBy(2_000);
                expect(countRefreshes(sink)).toBe(2);

                // No further changes; advancing more time must NOT
                // re-arm or re-fire the trailing timer.
                await advanceBy(60_000);
                expect(countRefreshes(sink)).toBe(2);
            } finally {
                setAnalyticsSink(previous);
            }
        });

        /*
         * R-A M3 follow-up: the trailing setTimeout used to close over
         * `fingerprint` at SCHEDULE time. Edge case: user changes
         * B → C mid-gate (timer captures C); then undoes C → B before
         * the timer fires. The trailing must NOT corrupt
         * lastFingerprintRef with the stale C (a subsequent effect run
         * would otherwise see a phantom fingerprintChanged and burn
         * another refetch). The fix reads the live fingerprint via a
         * ref at FIRE time and no-ops when nothing actually changed.
         */
        it("trailing timer reads the current fingerprint at fire time and no-ops on undo-within-gate", async () => {
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
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });

                // First change — fires immediately, arms the gate.
                // Final state for "B" baseline is [task-1].
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // Second change at T=5s (B → C, mid-gate). Schedules a
                // trailing timer that — without the fix — closes over
                // the fingerprint for [task-1, task-2].
                await advanceBy(5_000);
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                expect(countRefreshes(sink)).toBe(1);

                // Third change at T=10s undoes C → B (back to [task-1]).
                // The trailing timer is still armed. The current effect
                // run sees fingerprint === lastFingerprintRef (B == B) so
                // it goes through the no-change branch and the timer
                // stays pending with its stale-C closure.
                await advanceBy(5_000);
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // Cross the trailing-edge boundary (T=30s). The timer
                // fires, reads the live fingerprint from the ref, sees
                // it equals `lastFingerprintRef` (both B), and no-ops.
                // Without the fix, the timer would track BRIEF_REFRESHED
                // and stamp lastFingerprintRef with the stale C — a
                // later effect run would then re-fire because
                // current B !== stale C.
                await advanceBy(20_000);
                expect(countRefreshes(sink)).toBe(1);

                // Sanity: a subsequent real change (B → D) still fires
                // immediately (the no-op trailing left the gate alone).
                await advanceBy(5_000);
                await mutateTasks(controls!, [newTask("1"), newTask("3")]);
                expect(countRefreshes(sink)).toBe(2);
            } finally {
                setAnalyticsSink(previous);
            }
        });

        /*
         * Cleanup path: an armed trailing timer must be cancelled the
         * moment a manual refresh fires. Without that, the trailing
         * would land seconds after the user's explicit click, burning
         * a redundant provider call on identical state.
         *
         * Setup: the FIRST fingerprint change fires immediately because
         * lastAutoRefreshAt is still 0. That call consumes the
         * "instant feedback" credit and arms the gate. We then schedule
         * the trailing with a second change at T=5s, click refresh at
         * T=10s, and verify no auto refetch lands when the trailing
         * would otherwise fire.
         */
        it("trailing timer is cleared when the user clicks manual refresh while armed", async () => {
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
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });

                // T=0 — first change fires immediately, arms the gate.
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // T=5s — second change inside the gate schedules a
                // trailing timer for T=30s.
                await advanceBy(5_000);
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                expect(countRefreshes(sink)).toBe(1);

                // T=10s — user clicks the regenerate button. Manual
                // refresh resets lastAutoRefreshAt AND clears the
                // pending trailing timer.
                await advanceBy(5_000);
                await act(async () => {
                    fireEvent.click(
                        screen.getByRole("button", {
                            name: microcopy.ai.regenerateLabel as string
                        })
                    );
                    await Promise.resolve();
                });

                // Advance well past where the trailing would have fired
                // (T=30s mark relative to the first auto fire, plus
                // headroom). No fingerprint-driven refetch should land —
                // the manual click owned the surface.
                await advanceBy(60_000);
                expect(countRefreshes(sink)).toBe(1);
            } finally {
                setAnalyticsSink(previous);
            }
        });

        /*
         * Cleanup path: switching to Chat while a trailing timer is
         * armed must cancel it. We never want a delayed refetch firing
         * while the user is reading chat — the existing surface-flip
         * effect handles this; the test pins the contract so a refactor
         * can't drop the clearTimeout silently.
         */
        it("trailing timer is cleared when the user switches tabs while armed", async () => {
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
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });

                // T=0 — first change fires immediately, arms the gate.
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // T=5s — second change schedules the trailing timer.
                await advanceBy(5_000);
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                expect(countRefreshes(sink)).toBe(1);

                // T=10s — switch to Chat. surfaceVisible flips false on
                // the brief body, which must drop the trailing timer.
                await advanceBy(5_000);
                await act(async () => {
                    fireEvent.click(
                        screen.getByRole("tab", {
                            name: microcopy.copilotDock.tabChat as string
                        })
                    );
                    await Promise.resolve();
                });

                // Advance past the trailing-fire boundary. No refetch
                // should land while the user is on Chat.
                await advanceBy(60_000);
                expect(countRefreshes(sink)).toBe(1);
            } finally {
                setAnalyticsSink(previous);
            }
        });

        /*
         * Cleanup path: unmounting the dock while a trailing timer is
         * armed must not leave a phantom setTimeout that fires into a
         * torn-down agent hook. The component's teardown effect handles
         * this; the test pins the contract by spying clearTimeout and
         * asserting the armed handle was cleared.
         */
        it("trailing timer is cleared on unmount while armed", async () => {
            const sink = jest.fn<
                ReturnType<AnalyticsSink>,
                Parameters<AnalyticsSink>
            >();
            const previous = setAnalyticsSink(sink);
            const clearTimeoutSpy = jest.spyOn(window, "clearTimeout");
            let controls: {
                setTasks: React.Dispatch<React.SetStateAction<ITask[]>>;
            } | null = null;
            try {
                const { unmount } = renderControlled({
                    initialTab: "brief",
                    onMount: (c) => {
                        controls = c;
                    }
                });
                await waitFor(() => {
                    expect(
                        sink.mock.calls.filter(
                            ([event]) =>
                                event === ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN
                        )
                    ).toHaveLength(1);
                });

                // T=0 — first change fires immediately, arms the gate.
                await mutateTasks(controls!, [newTask("1")]);
                expect(countRefreshes(sink)).toBe(1);

                // T=5s — second change schedules the trailing timer.
                // Capture the IDs in flight at the time of the schedule
                // so we can confirm the unmount path cleared one of
                // them (jsdom assigns monotonic numeric handles).
                await advanceBy(5_000);
                const clearCallsBeforeUnmount =
                    clearTimeoutSpy.mock.calls.length;
                await mutateTasks(controls!, [newTask("1"), newTask("2")]);
                expect(countRefreshes(sink)).toBe(1);

                // T=10s — unmount the dock. The teardown effect must
                // call clearTimeout on the armed handle.
                await advanceBy(5_000);
                await act(async () => {
                    unmount();
                    await Promise.resolve();
                });

                // The teardown ran at least one clearTimeout that
                // wasn't there before the schedule.
                expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(
                    clearCallsBeforeUnmount
                );

                // Belt-and-braces: even if some other clearTimeout had
                // been queued, advancing past the trailing-fire
                // boundary must NOT track another refresh — the brief
                // body is unmounted, so no fingerprint-driven refetch
                // can land.
                await advanceBy(60_000);
                expect(countRefreshes(sink)).toBe(1);
            } finally {
                clearTimeoutSpy.mockRestore();
                setAnalyticsSink(previous);
            }
        });
    });
});
