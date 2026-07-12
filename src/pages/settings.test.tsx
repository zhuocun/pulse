/* eslint-disable global-require */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";

import SettingsPage from "./settings";

jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useColorScheme");
jest.mock("../utils/hooks/useIsPhoneChrome");

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;
const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
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
        // The colour-theme picker reads + dispatches against the
        // userPreferences slice, so the page needs a real Redux Provider.
        // We use the app store singleton — the other settings controls are
        // mocked at the hook layer, so the only slice interaction here is
        // the colour-theme read/write.
        <Provider store={store}>
            <BrowserRouter>
                <SettingsPage />
            </BrowserRouter>
        </Provider>
    );

describe("SettingsPage", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        // Default to the desktop chassis so the legacy `Card` layout is
        // exercised; the phone branch is covered in its own describe.
        mockedUseIsPhoneChrome.mockReturnValue(false);
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

    it("renders the theme, language, color-theme, AI, and logout rows", () => {
        renderPage();
        expect(screen.getByTestId("settings-row-theme")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-language")).toBeInTheDocument();
        expect(
            screen.getByTestId("settings-row-color-theme")
        ).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-ai")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-logout")).toBeInTheDocument();
    });

    it("constrains the desktop settings list to a readable scan width", () => {
        renderPage();
        const list = screen.getByTestId("settings-row-theme").parentElement;
        expect(list).not.toBeNull();
        // The list caps its scan width and centres on desktop via Tailwind
        // utilities (max-width: 48rem + margin-inline: auto).
        expect(list).toHaveClass("mx-auto");
        expect(list).toHaveClass("max-w-[48rem]");
    });

    it("renders the three-palette color-theme picker", () => {
        renderPage();
        const row = screen.getByTestId("settings-row-color-theme");
        // The picker is a Segmented with one radio per shipped palette.
        for (const name of [
            microcopy.settings.colorThemeOrange,
            microcopy.settings.colorThemeBlue,
            microcopy.settings.colorThemeEmerald
        ]) {
            expect(
                within(row).getByRole("radio", { name })
            ).toBeInTheDocument();
        }
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

describe("SettingsPage (phone chassis)", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        // Coarse pointer → grouped-table sections instead of Card rows.
        mockedUseIsPhoneChrome.mockReturnValue(true);
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

    it("renders the three grouped section headers", () => {
        renderPage();
        // All three groups mount on phone.
        expect(
            screen.getByTestId("settings-section-appearance")
        ).toBeInTheDocument();
        expect(
            screen.getByTestId("settings-section-copilot")
        ).toBeInTheDocument();
        expect(
            screen.getByTestId("settings-section-account")
        ).toBeInTheDocument();
        // Appearance / Account headers are unique strings.
        expect(
            within(screen.getByTestId("settings-section-appearance")).getByText(
                microcopy.settings.sections.appearance.header
            )
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId("settings-section-account")).getByText(
                microcopy.settings.sections.account.header
            )
        ).toBeInTheDocument();
        // The Board Copilot section has no header (its footer gloss supplies
        // the context); the "Board Copilot" string appears only as the AI
        // row's own label.
        const copilotSection = screen.getByTestId("settings-section-copilot");
        const aiRow = within(copilotSection).getByTestId("settings-row-ai");
        expect(
            within(aiRow).getByText(microcopy.settings.aiEnabled)
        ).toBeInTheDocument();
    });

    it("nests the color-theme picker inside a collapsed Appearance disclosure", () => {
        renderPage();
        const appearance = screen.getByTestId("settings-section-appearance");
        expect(
            within(appearance).getByTestId("settings-color-theme-collapse")
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId("settings-row-color-theme")
        ).not.toBeInTheDocument();
    });

    it("keeps the settings rows with their controls", () => {
        renderPage();
        expect(screen.getByTestId("settings-row-theme")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-language")).toBeInTheDocument();
        expect(
            screen.getByTestId("settings-color-theme-collapse")
        ).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-ai")).toBeInTheDocument();
        expect(screen.getByTestId("settings-row-logout")).toBeInTheDocument();
        // The widgets still resolve by role, so the controls survived the
        // move into the grouped rows.
        expect(
            screen.getByRole("radio", { name: microcopy.settings.themeLight })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("switch", {
                name: microcopy.settings.toggleBoardCopilot
            })
        ).toBeInTheDocument();
        expect(
            screen.getAllByRole("button", { name: microcopy.actions.logOut })
                .length
        ).toBeGreaterThan(0);
    });

    it("drives the same hooks from the grouped controls", () => {
        const setPreference = jest.fn();
        const setEnabled = jest.fn();
        const logout = jest.fn();
        mockedUseColorScheme.mockReturnValue({
            preference: "light",
            scheme: "light",
            setPreference
        });
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled
        });
        mockedUseAuth.mockReturnValue({
            user: { _id: "u1", email: "a@b.c", username: "Alice" } as IUser,
            isAuthenticated: true,
            logout
        });
        renderPage();
        fireEvent.click(
            screen.getByRole("radio", { name: microcopy.settings.themeDark })
        );
        expect(setPreference).toHaveBeenCalledWith("dark");
        fireEvent.click(
            screen.getByRole("switch", {
                name: microcopy.settings.toggleBoardCopilot
            })
        );
        expect(setEnabled.mock.calls[0]?.[0]).toBe(false);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: microcopy.actions.logOut
            })[0]!
        );
        expect(logout).toHaveBeenCalledTimes(1);
    });

    it("omits the Board Copilot section when AI is unavailable", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: false,
            enabled: false,
            setEnabled: jest.fn()
        });
        renderPage();
        expect(screen.queryByTestId("settings-row-ai")).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("settings-section-copilot")
        ).not.toBeInTheDocument();
        // The other two sections still render.
        expect(
            screen.getByTestId("settings-section-appearance")
        ).toBeInTheDocument();
        expect(
            screen.getByTestId("settings-section-account")
        ).toBeInTheDocument();
    });
});
