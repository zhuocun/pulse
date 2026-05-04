/* eslint-disable global-require */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { useNavigate } from "react-router";

import useAuth from "../../utils/hooks/useAuth";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useColorScheme from "../../utils/hooks/useColorScheme";

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

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
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
    colorScheme?: Partial<ReturnType<typeof useColorScheme>>
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
            screen.getByRole("button", { name: /go to projects/i })
        ).toBeInTheDocument();
        expect(screen.getByText("Members")).toBeInTheDocument();
        expect(accountTrigger()).toBeInTheDocument();
        expect(screen.getByText(/hi, alice/i)).toBeInTheDocument();
    });

    it("navigates to projects with viewTransition when the logo is clicked outside the projects list", () => {
        const { navigate } = renderHeader("/projects/p1/board");

        fireEvent.click(
            screen.getByRole("button", { name: /go to projects/i })
        );

        expect(navigate).toHaveBeenCalledWith("/projects", {
            viewTransition: true
        });
    });

    it("does not navigate when already on the projects list", () => {
        const { navigate } = renderHeader("/projects");

        fireEvent.click(
            screen.getByRole("button", { name: /go to projects/i })
        );

        expect(navigate).not.toHaveBeenCalled();
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
});
