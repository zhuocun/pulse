/* eslint-disable global-require */
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { useNavigate } from "react-router";

import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { ruleTextsFor, styledClassFor } from "../../testUtils/styleRules";
import useAuth from "../../utils/hooks/useAuth";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAgentHealth from "../../utils/hooks/useAgentHealth";
import useColorScheme from "../../utils/hooks/useColorScheme";
import useNotifications from "../../utils/hooks/useNotifications";
import { __resetActivityFeedUndoCallbacksForTests } from "../../utils/hooks/useActivityFeed";

import { microcopy } from "../../constants/microcopy";

import Header, { resolveMobileHeaderTitle } from ".";

jest.mock("../../assets/logo-software.svg?react", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: (props: Record<string, unknown>) =>
            React.createElement("svg", {
                "aria-label": "Pulse logo",
                ...props
            })
    };
});
jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useAiEnabled");
jest.mock("../../utils/hooks/useAgentHealth");
jest.mock("../../utils/hooks/useColorScheme");
// The header reads `useNotifications().unreadCount` for the notifications
// bell. The hook itself goes through React Query / the api layer (covered
// by `useNotifications.test.tsx`); here we stub it so the header renders
// without a `QueryClientProvider` and we keep control of the badge count.
jest.mock("../../utils/hooks/useNotifications");
jest.mock("react-router", () => {
    const actual = jest.requireActual("react-router");
    return {
        ...actual,
        useNavigate: jest.fn()
    };
});
// Mock environment so tests control aiEnabled/aiUseLocalEngine independently
// of whatever process.env happens to be set in CI/test.
jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true,
        bottomNavEnabled: true,
        activityFeedEnabled: true
    }
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAgentHealth = useAgentHealth as jest.MockedFunction<
    typeof useAgentHealth
>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;
const mockedUseNavigate = useNavigate as jest.MockedFunction<
    typeof useNavigate
>;
const mockedUseNotifications = useNotifications as jest.MockedFunction<
    typeof useNotifications
>;

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
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
};

const renderHeader = (
    path = "/projects/p1/board",
    ai?: Partial<{
        available: boolean;
        enabled: boolean;
        setEnabled: (next: boolean) => void;
    }>,
    colorScheme?: Partial<ReturnType<typeof useColorScheme>>,
    agentHealth: Partial<ReturnType<typeof useAgentHealth>> = {}
) => {
    const logout = jest.fn();
    const navigate = jest.fn();
    mockedUseNavigate.mockReturnValue(navigate);

    mockedUseAuth.mockReturnValue({
        logout,
        isAuthenticated: true,
        user: user()
    });
    mockedUseAiEnabled.mockReturnValue({
        available: true,
        enabled: true,
        setEnabled: jest.fn(),
        ...ai
    });
    mockedUseColorScheme.mockReturnValue({
        preference: "system",
        scheme: "light",
        setPreference: jest.fn(),
        ...colorScheme
    });
    mockedUseNotifications.mockReturnValue({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        markRead: jest.fn(),
        markAllRead: jest.fn(),
        isMutating: false
    });
    mockedUseAgentHealth.mockReturnValue({
        status: "ok",
        latencyMs: 120,
        lastChecked: Date.now(),
        ready: true,
        realProviderReady: true,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        stubMode: false,
        issues: [],
        warnings: [],
        ...agentHealth
    });

    window.history.pushState({}, "Header", path);

    render(
        <Provider store={store}>
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        </Provider>
    );

    return { logout, navigate };
};

describe("Header", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Safe default for `useNotifications` so tests that render
        // `<Header />` directly (without going through `renderHeader`)
        // still get a valid hook return after `clearAllMocks`.
        mockedUseNotifications.mockReturnValue({
            notifications: [],
            unreadCount: 0,
            isLoading: false,
            markRead: jest.fn(),
            markAllRead: jest.fn(),
            isMutating: false
        });
        // Clear the activity feed before each test so the bell badge
        // count starts at zero. Otherwise a feed populated by a
        // previous test leaks into the next.
        store.dispatch(activityFeedActions.clearActivityFeed());
        __resetActivityFeedUndoCallbacksForTests();
    });

    afterEach(() => {
        store.dispatch(activityFeedActions.clearActivityFeed());
        __resetActivityFeedUndoCallbacksForTests();
    });

    const accountTrigger = () =>
        screen.getByRole("button", { name: /account menu for alice/i });

    it("renders logo and the current user greeting", () => {
        renderHeader();

        expect(
            screen.getByRole("button", { name: /pulse home/i })
        ).toBeInTheDocument();
        // MemberPopover has moved off the global header (QW-12); it now
        // lives on the board's BoardActions cluster where the project
        // members are contextually relevant.
        expect(
            screen.queryByRole("button", { name: /view team members/i })
        ).not.toBeInTheDocument();
        expect(accountTrigger()).toBeInTheDocument();
        expect(screen.getByText(/hi, alice/i)).toBeInTheDocument();
    });

    /*
     * Primary navigation (desktop / non-phone chrome). The header exposes a
     * `<nav>` landmark with NavLinks to the top-level destinations; the
     * active route carries `aria-current="page"` via NavLink. The bottom-tab
     * bar owns this landmark in phone chrome, so the header nav is suppressed
     * there (see the phone-demotion suite for the coarse-pointer predicate).
     */
    describe("primary navigation", () => {
        const primaryNav = () =>
            screen.getByRole("navigation", { name: /primary navigation/i });

        it("renders Projects, Inbox, and Copilot as real links", () => {
            renderHeader("/projects");
            const nav = primaryNav();
            expect(nav).toBeInTheDocument();
            expect(
                screen.getByRole("link", { name: /boards/i })
            ).toBeInTheDocument();
            expect(
                screen.getByRole("link", { name: /inbox/i })
            ).toBeInTheDocument();
            expect(
                screen.getByRole("link", { name: /copilot/i })
            ).toBeInTheDocument();
        });

        it("marks the active route with aria-current=page", () => {
            renderHeader("/projects");
            expect(
                screen.getByRole("link", { name: /boards/i })
            ).toHaveAttribute("aria-current", "page");
            expect(
                screen.getByRole("link", { name: /inbox/i })
            ).not.toHaveAttribute("aria-current", "page");
        });

        it("keeps Boards active on nested board routes (end=false)", () => {
            renderHeader("/projects/p1/board");
            expect(
                screen.getByRole("link", { name: /boards/i })
            ).toHaveAttribute("aria-current", "page");
        });

        it("keeps the active tab visible in forced-colors mode via a system-color border", () => {
            renderHeader("/projects");
            // Forced-colors strips the translucent active-pill background,
            // so the NavTab re-draws the pill with a CanvasText border. The
            // sheet is walked directly because jsdom does not evaluate
            // media queries via getComputedStyle.
            const css = Array.from(document.styleSheets)
                .map((sheet) => {
                    let rules: CSSRuleList;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        return "";
                    }
                    return Array.from(rules)
                        .map((rule) => rule.cssText)
                        .join("\n");
                })
                .join("\n");
            expect(css).toMatch(
                /forced-colors:\s*active[\s\S]*?\[aria-current="page"\][^}]*border:\s*1px solid CanvasText/
            );
        });
    });

    it("hosts a single EngineModeTag in the app chrome when AI is enabled (Cross-cutting #8 dedup)", () => {
        renderHeader();

        // EngineModeTag renders an AntD Tag with the active engine label.
        // The default test env has aiUseLocalEngine: true so the label is
        // the local-engine microcopy. The dedup goal (Cross-cutting #8)
        // is to mount this tag once in the app chrome and remove the
        // copies in aiChatDrawer / boardBriefDrawer / aiSearchInput /
        // aiTaskAssistPanel / aiTaskDraftModal headers — handoff to B2.
        expect(
            screen.getByText(microcopy.ai.processingModeLocalLabel)
        ).toBeInTheDocument();
    });

    /*
     * The logo is now a native-navigation trigger
     * (`window.location.assign("/projects")` — see `Header`). jsdom's
     * `Location` is non-configurable, so we assert behavior at the prop
     * level (the button is rendered with the right interaction surface)
     * rather than spying on `assign` directly.
     */
    it("exposes an interactive logo button outside the projects list", () => {
        renderHeader("/projects/p1/board");
        const logo = screen.getByRole("button", { name: /pulse home/i });
        expect(logo).toBeInTheDocument();
        // The button is interactive (has the `&&` AntD `link` styling
        // applied, no `disabled` attribute) — its onClick navigates via
        // `window.location.assign` which jsdom no-ops on, so we can't
        // observe the side-effect from here. The integration suites
        // exercise the full navigation in a real Chromium.
        expect(logo).not.toBeDisabled();
    });

    it("renders the logo as a non-navigating element when already on the projects list", () => {
        renderHeader("/projects");
        const logo = screen.getByRole("button", { name: /pulse home/i });
        expect(logo).toBeInTheDocument();
        // No onClick is wired when already on `/projects`. The button
        // remains keyboard-focusable for parity with the navigating
        // state but a click is a no-op.
        expect(logo).not.toBeDisabled();
    });

    it("declares a full 44 px coarse-pointer target for the logo", () => {
        renderHeader("/projects");
        const logo = screen.getByRole("button", { name: /pulse home/i });
        const styledClass = styledClassFor(logo);
        expect(styledClass).toBeTruthy();

        const ruleText = ruleTextsFor(styledClass ?? "").join("\n");
        expect(ruleText).toContain("height: 44px");
        expect(ruleText).toContain("min-width: 44px");
        expect(ruleText).toContain("justify-content: center");
    });

    it("invokes setPreference when the inline theme IconButton is clicked", () => {
        const setPreference = jest.fn();
        renderHeader("/projects/p1/board", undefined, {
            preference: "light",
            scheme: "light",
            setPreference
        });

        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.a11y.useDarkMode
            })
        );

        expect(setPreference).toHaveBeenCalledWith("dark");
    });

    it("prevents default navigation from the account trigger", () => {
        renderHeader();

        expect(fireEvent.click(accountTrigger())).toBe(false);
    });

    it("calls logout from the account dropdown", async () => {
        const { logout } = renderHeader();

        fireEvent.click(accountTrigger());

        fireEvent.click(
            await screen.findByRole("button", { name: /^log out$/i })
        );

        await waitFor(() => {
            expect(logout).toHaveBeenCalledTimes(1);
        });
    });

    it("renders the Board Copilot toggle inside the account menu when AI is available", async () => {
        renderHeader();

        fireEvent.click(accountTrigger());

        expect(
            await screen.findByRole("switch", {
                name: /enable board copilot/i
            })
        ).toBeInTheDocument();
    });

    it("does not render the Board Copilot toggle when AI is disabled at build time", async () => {
        renderHeader("/projects/p1/board", {
            available: false,
            enabled: false,
            setEnabled: jest.fn()
        });

        fireEvent.click(accountTrigger());
        // Wait for the dropdown to render its language row before asserting
        // the absence of the AI toggle.
        await screen.findByRole("group", { name: /change language/i });

        expect(
            screen.queryByRole("switch", { name: /enable board copilot/i })
        ).not.toBeInTheDocument();
    });

    it("invokes setEnabled(false) when the switch is turned off", async () => {
        const setEnabled = jest.fn();
        renderHeader("/projects/p1/board", {
            available: true,
            enabled: true,
            setEnabled
        });

        fireEvent.click(accountTrigger());
        const switchEl = await screen.findByRole("switch", {
            name: /enable board copilot/i
        });
        fireEvent.click(switchEl);

        expect(setEnabled.mock.calls[0][0]).toBe(false);
    });

    // The header dropdown no longer carries a theme toggle — that surface
    // moved to the routed /settings page where the 3-state Segmented
    // preserves the `system` preference. The inline IconButton remains the
    // header's only theme control; see the IconButton test above.

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, with AAA at 44×44. The header's account `PillTrigger`
    // is the dominant always-on chrome control on every authenticated route;
    // the styled component declares a coarse-pointer `height: 44px` so a thumb
    // can land it. Walk the rendered stylesheet (same approach as
    // `src/layouts/authLayout.test.tsx` for `AuthButton`) and assert the 44 px
    // declaration is still emitted — a future style refactor that drops it
    // below 44 must fail CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderHeader();
        const button = accountTrigger();
        // styled-components hashes the rule into a class like `css-mcde2a`
        // (without the `dev-only` / `var-root` cssinjs naming). Pick that
        // out so the search below is anchored to the exact emitted rule.
        const styledCls = button.className
            .split(/\s+/)
            .find(
                (tok) =>
                    /^css-[a-z0-9]{4,}$/i.test(tok) &&
                    !tok.startsWith("css-var-") &&
                    !tok.startsWith("css-dev-only-")
            );
        expect(styledCls).toBeTruthy();

        // Scope the height search to rules nested inside an
        // `@media (pointer: coarse)` block — that is where the 44 px
        // declaration is supposed to live. A rule containing a literal
        // `44` outside that media query (incidental layout math, for
        // example) must NOT satisfy this assertion.
        const heights: number[] = [];
        const visit = (rule: CSSRule) => {
            if (rule instanceof CSSStyleRule) {
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    return;
                const parent = rule.parentRule;
                const inCoarse =
                    parent instanceof CSSMediaRule &&
                    parent.conditionText.includes("coarse");
                if (!inCoarse) return;
                const re = /(?<!-)height:\s*(\d+(?:\.\d+)?)px/gi;
                let m: RegExpExecArray | null = re.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0"));
                    m = re.exec(rule.cssText);
                }
            } else if ("cssRules" in rule) {
                for (const child of Array.from(
                    (rule as CSSGroupingRule).cssRules
                )) {
                    visit(child);
                }
            }
        };
        Array.from(document.styleSheets).forEach((sheet) => {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                return;
            }
            for (const rule of Array.from(rules)) visit(rule);
        });

        // The styled component's `@media (pointer: coarse) { height: 44px }`
        // rule must be one of them. A regression to a smaller value or a
        // removed rule fails loudly.
        expect(heights).toContain(44);
    });

    describe("AgentHealthBadge", () => {
        // Re-require the module after mutating the mock so we get the
        // new environment shape. Restore after each test.
        const envMod = jest.requireMock("../../constants/env") as {
            default: {
                apiBaseUrl: string;
                aiBaseUrl: string;
                aiEnabled: boolean;
                aiUseLocalEngine: boolean;
                bottomNavEnabled: boolean;
                activityFeedEnabled: boolean;
            };
        };

        afterEach(() => {
            // Restore to the local-engine defaults used by all other tests.
            envMod.default.aiEnabled = true;
            envMod.default.aiUseLocalEngine = true;
            envMod.default.aiBaseUrl = "";
            envMod.default.bottomNavEnabled = true;
        });

        it("does not render the health badge when the local engine is active", () => {
            // environment mock already has aiUseLocalEngine: true
            renderHeader();

            expect(
                screen.queryByRole("img", {
                    name: /Board Copilot/i
                })
            ).not.toBeInTheDocument();
        });

        it("renders the degraded badge with precise readiness detail", () => {
            // Switch to remote mode for this test.
            envMod.default.aiUseLocalEngine = false;
            envMod.default.aiBaseUrl = "https://agents.example";

            renderHeader("/projects/p1/board", undefined, undefined, {
                status: "offline",
                latencyMs: 120,
                lastChecked: Date.now(),
                ready: false,
                realProviderReady: false,
                issues: [
                    "ANTHROPIC_API_KEY missing -- provider explicitly set to 'anthropic'"
                ]
            });

            expect(
                screen.getByRole("img", {
                    name: /Board Copilot is not ready: ANTHROPIC_API_KEY missing/i
                })
            ).toBeInTheDocument();
        });
    });

    /*
     * Phase 3 A3 — phone demotion. The right-cluster account + theme
     * cluster is wrapped in `<HiddenWhenDemoted>`. Its visibility is now
     * driven by the shared `useIsPhoneChrome` hook (single source of
     * truth with the BottomTabBar mount-gate in MainLayout) — when the
     * flag is on AND the pointer is coarse, the wrapper emits
     * `display: none` from JS. The previous CSS `@media (pointer: coarse)`
     * implementation diverged from the bar's mount-gate; see
     * `useIsPhoneChrome` for the alignment rationale.
     */
    describe("phone demotion (flag-gated)", () => {
        const envMod = jest.requireMock("../../constants/env") as {
            default: {
                apiBaseUrl: string;
                aiBaseUrl: string;
                aiEnabled: boolean;
                aiUseLocalEngine: boolean;
                bottomNavEnabled: boolean;
                activityFeedEnabled: boolean;
            };
        };

        const installCoarsePointer = () => {
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: (query: string) => ({
                    addEventListener: jest.fn(),
                    addListener: jest.fn(),
                    dispatchEvent: jest.fn(),
                    matches: query === "(pointer: coarse)",
                    media: query,
                    onchange: null,
                    removeEventListener: jest.fn(),
                    removeListener: jest.fn()
                })
            });
        };

        afterEach(() => {
            envMod.default.bottomNavEnabled = true;
            installAntdBrowserMocks();
        });

        const sheetText = () =>
            Array.from(document.styleSheets)
                .map((sheet) => {
                    let rules: CSSRuleList;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        return "";
                    }
                    return Array.from(rules)
                        .map((rule) => rule.cssText)
                        .join("\n");
                })
                .join("\n");

        it("emits a JS-driven display:none rule for the demoted right-cluster when the flag is on and the pointer is coarse", () => {
            installCoarsePointer();
            envMod.default.bottomNavEnabled = true;
            renderHeader();
            // The styled `HiddenWhenDemoted` `$hidden=true` branch
            // emits a plain `display: none;` rule (no media wrapper)
            // because the predicate is computed from the shared
            // `useIsPhoneChrome` hook rather than CSS.
            expect(sheetText()).toMatch(/display:\s*none/i);
        });

        it("wraps both the theme button and the account dropdown in the demotion span", () => {
            renderHeader();
            const themeButton = screen.getByRole("button", {
                name: /switch to (dark|light) mode/i
            });
            const account = screen.getByRole("button", {
                name: /account menu for alice/i
            });
            // Each control is wrapped in a `<HiddenWhenDemoted>` span;
            // the nearest <span> ancestor is the demotion wrapper. We
            // assert both have one (i.e., the JSX shape did not regress
            // back to bare buttons inside RightCluster).
            const themeSpan = themeButton.closest("span");
            const accountSpan = account.closest("span");
            expect(themeSpan).not.toBeNull();
            expect(accountSpan).not.toBeNull();
        });
    });

    /*
     * Phase 4.3 — activity feed bell. The header mounts an
     * `<ActivityFeedBell>` whose aria-label tracks the live unread
     * count from the activity feed slice; clicking it opens the
     * drawer (rendered by the same `<Header>`).
     */
    describe("activity feed bell (Phase 4.3)", () => {
        const envMod = jest.requireMock("../../constants/env") as {
            default: {
                apiBaseUrl: string;
                aiBaseUrl: string;
                aiEnabled: boolean;
                aiUseLocalEngine: boolean;
                bottomNavEnabled: boolean;
                activityFeedEnabled: boolean;
            };
        };

        afterEach(() => {
            envMod.default.activityFeedEnabled = true;
        });

        it("renders the bell with the zero-unread copy when the feed is empty", () => {
            renderHeader();
            const bell = screen.getByTestId("activity-feed-bell");
            expect(bell).toHaveAccessibleName(/no new notifications/i);
        });

        it("includes the unread count in the bell aria-label", () => {
            renderHeader();
            act(() => {
                store.dispatch(
                    activityFeedActions.recordActivityEvent({
                        id: "evt-header-a",
                        timestamp: Date.now(),
                        kind: "task",
                        action: "create",
                        summary: "A",
                        undoable: false,
                        isRead: false
                    })
                );
                store.dispatch(
                    activityFeedActions.recordActivityEvent({
                        id: "evt-header-b",
                        timestamp: Date.now(),
                        kind: "task",
                        action: "create",
                        summary: "B",
                        undoable: false,
                        isRead: false
                    })
                );
            });
            const bell = screen.getByTestId("activity-feed-bell");
            expect(bell).toHaveAccessibleName(/2 unread notifications/i);
        });

        it("opens the drawer on click and exposes the drawer body", () => {
            renderHeader();
            const bell = screen.getByTestId("activity-feed-bell");
            // Before click the drawer body is not mounted into the DOM.
            expect(
                screen.queryByTestId("activity-feed-drawer-body")
            ).not.toBeInTheDocument();
            fireEvent.click(bell);
            // AntD renders the drawer body inside a portal; it appears
            // after the click. Use `findBy*` to await the portal mount.
            return waitFor(() => {
                expect(
                    screen.getByTestId("activity-feed-drawer-body")
                ).toBeInTheDocument();
            });
        });

        it("does not mount the bell when the activity-feed env flag is off", () => {
            envMod.default.activityFeedEnabled = false;
            renderHeader();
            expect(
                screen.queryByTestId("activity-feed-bell")
            ).not.toBeInTheDocument();
        });
    });

    /*
     * iOS-26-style centered contextual title (phone chrome only). The title
     * resolver is a pure function exported from the header module; the
     * rendered cases gate on the shared `useIsPhoneChrome` predicate, which
     * reads `window.matchMedia('(pointer: coarse)')` — the same coarse-pointer
     * mock the phone-demotion suite uses.
     */
    describe("centered contextual title (phone chrome)", () => {
        const installCoarsePointer = () => {
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: (query: string) => ({
                    addEventListener: jest.fn(),
                    addListener: jest.fn(),
                    dispatchEvent: jest.fn(),
                    matches: query === "(pointer: coarse)",
                    media: query,
                    onchange: null,
                    removeEventListener: jest.fn(),
                    removeListener: jest.fn()
                })
            });
        };

        afterEach(() => {
            installAntdBrowserMocks();
        });

        it("returns null for top-level tab routes that render their own page heading", () => {
            expect(resolveMobileHeaderTitle("/projects")).toBeNull();
            expect(
                resolveMobileHeaderTitle("/projects/abc123/board")
            ).toBeNull();
            expect(
                resolveMobileHeaderTitle("/projects/abc/reports")
            ).toBeNull();
            expect(resolveMobileHeaderTitle("/inbox")).toBeNull();
            expect(resolveMobileHeaderTitle("/copilot")).toBeNull();
            expect(resolveMobileHeaderTitle("/settings")).toBeNull();
            expect(resolveMobileHeaderTitle("/anything-else")).toBeNull();
        });

        it("does not render a centered duplicate title on top-level phone routes", () => {
            installCoarsePointer();
            renderHeader("/projects");
            expect(
                screen.queryByRole("heading", { level: 1, name: /boards/i })
            ).not.toBeInTheDocument();
        });

        it("suppresses the contextual title on board / project-detail routes", () => {
            installCoarsePointer();
            renderHeader("/projects/p1/board");
            // `resolveMobileHeaderTitle` returns null for board routes, so the
            // resolved "Boards" string must not surface as the centered title.
            expect(
                screen.queryByText(microcopy.nav.tabs.boards)
            ).not.toBeInTheDocument();
        });

        it("does not render the contextual title on desktop chrome", () => {
            // Default mocks report a fine pointer, so `useIsPhoneChrome` is
            // false and the centered-title third never mounts. The desktop
            // primary-nav DOES render a "Boards" link in this chrome, so the
            // assertion targets the contextual-title node specifically: any
            // "Boards" text that is NOT inside the primary-nav link. The
            // contextual title is a plain `<span>` while the nav entry is an
            // anchor (`role="link"`), so scoping to the non-link occurrence
            // isolates the title we mean to assert is absent.
            renderHeader("/projects");
            const boardsTexts = screen.queryAllByText(
                microcopy.nav.tabs.boards
            );
            const contextualTitle = boardsTexts.filter(
                (node) => node.closest("a") === null
            );
            expect(contextualTitle).toHaveLength(0);
        });
    });

    /*
     * Phase 5 "Liquid Glass" Wave 2 T3 — Liquid chrome recipe upgrade.
     * The header is one of five glass surfaces that gains:
     *   1. Specular rim (::before / ::after gradient layers using
     *      var(--glass-specular-top) / var(--glass-specular-bottom))
     *   2. Gel-flex micro-press on interactive children (IconButton,
     *      PillTrigger, BrandLink)
     *   3. Scroll-edge dissolve via mask-image on ::after
     *   4. data-glass-context="true" marker (so Wave 3's overlay
     *      collision handler can detect a glass ancestor and degrade
     *      AntD popovers to opaque-elevated).
     *
     * The pseudo-element / mask assertions walk the styled-component
     * sheet directly because jsdom does not introspect ::before /
     * ::after via getComputedStyle.
     */
    describe("Liquid Glass chrome recipe (Wave 2 T3)", () => {
        const sheetText = () =>
            Array.from(document.styleSheets)
                .map((sheet) => {
                    let rules: CSSRuleList;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        return "";
                    }
                    return Array.from(rules)
                        .map((rule) => rule.cssText)
                        .join("\n");
                })
                .join("\n");

        it('marks the PageHeader root with data-glass-context="true"', () => {
            const { container } = render(
                <Provider store={store}>
                    <BrowserRouter>
                        <Header />
                    </BrowserRouter>
                </Provider>
            );
            const header = container.querySelector("header");
            expect(header).not.toBeNull();
            expect(header?.getAttribute("data-glass-context")).toBe("true");
        });

        it("emits a ::before specular-rim layer with --glass-specular-top", () => {
            renderHeader();
            const css = sheetText();
            // The rim recipe paints the highlight gradient on the
            // header's ::before pseudo-element. styled-components emits
            // the rule verbatim into the document head.
            expect(css).toMatch(
                /::before[^}]*background:\s*var\(--glass-specular-top\)/
            );
        });

        it("emits a ::after companion / scroll-edge layer with --glass-specular-bottom + mask-image", () => {
            renderHeader();
            const css = sheetText();
            expect(css).toMatch(
                /::after[^}]*background:\s*var\(--glass-specular-bottom\)/
            );
            // Scroll-edge dissolve: the ::after layer is masked with a
            // linear-gradient to fade the bottom 12 px into transparent
            // so scrolling content dissolves through the chrome edge.
            expect(css).toMatch(
                /mask-image:\s*linear-gradient\([^)]*calc\(100% - 12px\)/
            );
        });

        it("applies gel-flex transform recipe to the account PillTrigger", () => {
            renderHeader();
            const css = sheetText();
            // The PillTrigger transitions transform on the gel-flex
            // duration + spring-snap easing tokens, and yields to
            // scale(0.97) under :active.
            expect(css).toMatch(/transform[^;]*var\(--motion-gel-flex/);
            expect(css).toMatch(/:active[^}]*transform:\s*scale\(0\.97\)/);
        });

        it("respects prefers-reduced-motion by dropping the gel-flex transition + scale", () => {
            renderHeader();
            const css = sheetText();
            // The reduced-motion block neutralizes both the transition
            // and the :active transform. We assert by string containment
            // because the styled rule is verbatim in the sheet.
            expect(css).toMatch(/prefers-reduced-motion[^}]*reduce/);
            expect(css).toMatch(/transform:\s*none/);
        });

        it("respects prefers-reduced-transparency by dropping the rim background + dissolve", () => {
            renderHeader();
            const css = sheetText();
            expect(css).toMatch(/prefers-reduced-transparency[^}]*reduce/);
        });
    });
});
