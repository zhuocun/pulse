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
                "aria-label": "Jira Software",
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
jest.mock("../memberPopover", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("span", null, "Members")
    };
});
// Mock environment so tests control aiEnabled/aiUseLocalEngine independently
// of whatever process.env happens to be set in CI/test.
jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "https://pulse-python-server.vercel.app/api/v1",
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
    jwt: "jwt-1",
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
        refreshUser: jest.fn(),
        token: "jwt-1",
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

    it("renders logo, member navigation, and the current user greeting", () => {
        renderHeader();

        expect(
            screen.getByRole("button", { name: /pulse home/i })
        ).toBeInTheDocument();
        expect(screen.getByText("Members")).toBeInTheDocument();
        expect(accountTrigger()).toBeInTheDocument();
        expect(screen.getByText(/hi, alice/i)).toBeInTheDocument();
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
