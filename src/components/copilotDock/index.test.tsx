import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";

import CopilotDock, { type CopilotDockTab } from ".";

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
 * controlled wrapper threads the tab through real React state.
 */
interface ControlledDockProps {
    initialTab?: CopilotDockTab;
    initialOpen?: boolean;
}

const ControlledDock: React.FC<ControlledDockProps> = ({
    initialTab = "chat",
    initialOpen = true
}) => {
    const [activeTab, setActiveTab] = useState<CopilotDockTab>(initialTab);
    const [open, setOpen] = useState(initialOpen);
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
            tasks={[]}
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
     * composer text and abort any in-flight stream because the body's
     * teardown effect watched a single `open` prop that was passed as
     * `dockOpen && activeTab === "chat"`. After the prop split, the body
     * stays mounted across tab switches and the composer text must
     * survive a round-trip to the Brief tab.
     */
    it("preserves chat composer text across a Chat → Brief → Chat tab switch (R1-H1)", async () => {
        renderControlled({ initialTab: "chat" });

        const composer = (await screen.findByRole("textbox", {
            name: /message board copilot/i
        })) as HTMLTextAreaElement;
        fireEvent.change(composer, { target: { value: "hello copilot" } });
        expect(composer.value).toBe("hello copilot");

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
});
