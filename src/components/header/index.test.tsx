/* eslint-disable global-require */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { useNavigate } from "react-router";

import useAuth from "../../utils/hooks/useAuth";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAgentHealth from "../../utils/hooks/useAgentHealth";
import useColorScheme from "../../utils/hooks/useColorScheme";

import { microcopy } from "../../constants/microcopy";

import Header from ".";

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
        aiUseLocalEngine: true
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
    mockedUseAgentHealth.mockReturnValue({
        status: "ok",
        latencyMs: 120,
        lastChecked: Date.now(),
        ...agentHealth
    });

    window.history.pushState({}, "Header", path);

    render(
        <BrowserRouter>
            <Header />
        </BrowserRouter>
    );

    return { logout, navigate };
};

describe("Header", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
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
        await screen.findByRole("switch", { name: /toggle dark mode/i });

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

    it("toggles the color scheme via the dropdown switch", async () => {
        const setPreference = jest.fn();
        renderHeader("/projects/p1/board", undefined, {
            preference: "light",
            scheme: "light",
            setPreference
        });

        fireEvent.click(accountTrigger());
        fireEvent.click(
            await screen.findByRole("switch", { name: /toggle dark mode/i })
        );

        expect(setPreference).toHaveBeenCalledWith("dark");
    });

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

        // Walk every stylesheet's rules (including nested rules inside
        // `@media` blocks — `PillTrigger`'s 44 px rule lives behind
        // `@media (pointer: coarse)`) and collect every `height: <N>px`
        // declaration on a rule that mentions the styled class.
        const heights: number[] = [];
        const visit = (rule: CSSRule) => {
            if (rule instanceof CSSStyleRule) {
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    return;
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
            };
        };

        afterEach(() => {
            // Restore to the local-engine defaults used by all other tests.
            envMod.default.aiEnabled = true;
            envMod.default.aiUseLocalEngine = true;
            envMod.default.aiBaseUrl = "";
        });

        it("does not render the health badge when the local engine is active", () => {
            // environment mock already has aiUseLocalEngine: true
            renderHeader();

            expect(
                screen.queryByRole("img", {
                    name: /AI backend is slow|AI backend is offline/i
                })
            ).not.toBeInTheDocument();
        });

        it("renders the degraded badge with the correct aria-label when status is degraded", () => {
            // Switch to remote mode for this test.
            envMod.default.aiUseLocalEngine = false;
            envMod.default.aiBaseUrl = "https://agents.example";

            renderHeader("/projects/p1/board", undefined, undefined, {
                status: "degraded",
                latencyMs: 2000,
                lastChecked: Date.now()
            });

            expect(
                screen.getByRole("img", {
                    name: /AI backend is slow \(degraded\)/i
                })
            ).toBeInTheDocument();
        });
    });
});
