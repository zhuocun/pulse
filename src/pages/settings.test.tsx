/* eslint-disable global-require */
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";

import SettingsPage from "./settings";

jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useColorScheme");

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;

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

const renderPage = () =>
    render(
        <BrowserRouter>
            <SettingsPage />
        </BrowserRouter>
    );

describe("SettingsPage", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseAuth.mockReturnValue({
            user: { _id: "u1", email: "a@b.c", username: "Alice" } as IUser,
            isAuthenticated: true,
            logout: jest.fn()
        });
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        mockedUseColorScheme.mockReturnValue({
            preference: "light",
            scheme: "light",
            setPreference: jest.fn()
        });
    });

    it("renders the page heading and subtitle", () => {
        renderPage();
        expect(
            screen.getByRole("heading", {
                level: 1,
                name: microcopy.settings.pageTitle
            })
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.settings.pageSubtitle)
        ).toBeInTheDocument();
    });

    it("renders the theme, language, AI, and logout rows", () => {
        renderPage();
        expect(screen.getByTestId("settings-row-theme")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-language")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-ai")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-logout")).toBeInTheDocument();
    });

    it("hides the AI row when ai is unavailable at build time", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: false,
            enabled: false,
            setEnabled: jest.fn()
        });
        renderPage();
        expect(screen.queryByTestId("settings-row-ai")).not.toBeInTheDocument();
    });

    /*
     * The theme control is a 3-state Segmented (light / dark / system)
     * so a user who flips to dark can return to "follow OS". The
     * previous 2-state Switch dropped the system option entirely. We
     * assert that:
     *   1. All three options render.
     *   2. Clicking another option calls setPreference with that value.
     *   3. The user can return to `system` from any other state.
     */
    it("renders the 3-state theme Segmented control", () => {
        mockedUseColorScheme.mockReturnValue({
            preference: "system",
            scheme: "light",
            setPreference: jest.fn()
        });
        renderPage();
        expect(
            screen.getByRole("radio", {
                name: microcopy.settings.themeLight
            })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("radio", {
                name: microcopy.settings.themeDark
            })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("radio", {
                name: microcopy.settings.themeSystem
            })
        ).toBeInTheDocument();
    });

    it("calls setPreference('dark') when the Dark option is picked", () => {
        const setPreference = jest.fn();
        mockedUseColorScheme.mockReturnValue({
            preference: "light",
            scheme: "light",
            setPreference
        });
        renderPage();
        const darkOption = screen.getByRole("radio", {
            name: microcopy.settings.themeDark
        });
        fireEvent.click(darkOption);
        expect(setPreference).toHaveBeenCalledWith("dark");
    });

    it("can return the user to the System (follow OS) preference", () => {
        // Regression for the dropped 3rd state — once the user toggled
        // away from `system` under the old Switch they couldn't return.
        const setPreference = jest.fn();
        mockedUseColorScheme.mockReturnValue({
            preference: "dark",
            scheme: "dark",
            setPreference
        });
        renderPage();
        const systemOption = screen.getByRole("radio", {
            name: microcopy.settings.themeSystem
        });
        fireEvent.click(systemOption);
        expect(setPreference).toHaveBeenCalledWith("system");
    });

    it("toggles AI enabled via the Board Copilot switch", () => {
        const setEnabled = jest.fn();
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled
        });
        renderPage();
        const aiSwitch = screen.getByRole("switch", {
            name: microcopy.settings.toggleBoardCopilot
        });
        fireEvent.click(aiSwitch);
        // AntD's `<Switch onChange>` passes `(checked, event)`, so we
        // assert on the first positional arg only.
        expect(setEnabled).toHaveBeenCalledTimes(1);
        expect(setEnabled.mock.calls[0][0]).toBe(false);
    });

    it("calls logout when the Log out button fires", () => {
        const logout = jest.fn();
        mockedUseAuth.mockReturnValue({
            user: { _id: "u1", email: "a@b.c", username: "Alice" } as IUser,
            isAuthenticated: true,
            logout
        });
        renderPage();
        const logoutButtons = screen.getAllByRole("button", {
            name: microcopy.actions.logOut
        });
        // There are two: the aria-labeled button and its inner span — click
        // the first which is the host button.
        fireEvent.click(logoutButtons[0]!);
        expect(logout).toHaveBeenCalledTimes(1);
    });
});
