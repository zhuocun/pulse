import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import nativeNavigate from "../../utils/nativeNavigate";

import BottomTabBar from ".";

/*
 * `nativeNavigate` calls `window.location.assign(...)` in production
 * (no-op in jsdom). Mock to a spy so we can assert the URL the bar
 * forwards to the document-navigation hatch. The BottomTabBar routes
 * through `nativeNavigate` to bypass the iOS Safari WebKit / Chrome
 * Android "URL changed, page didn't navigate" purgatory (see
 * `src/utils/nativeNavigate.ts`).
 */
jest.mock("../../utils/nativeNavigate", () => ({
    __esModule: true,
    default: jest.fn()
}));

const mockedNativeNavigate = nativeNavigate as jest.MockedFunction<
    typeof nativeNavigate
>;

const renderBar = (initialPath = "/projects") =>
    render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route
                    path="*"
                    element={
                        <>
                            <BottomTabBar />
                            <main>page body</main>
                        </>
                    }
                />
            </Routes>
        </MemoryRouter>
    );

describe("BottomTabBar", () => {
    beforeEach(() => {
        mockedNativeNavigate.mockReset();
    });

    afterEach(() => {
        // Reset visualViewport mocks between tests so keyboard-state
        // assertions don't leak across cases. The cast widens window to
        // an interface that allows deletion of the optional property
        // (JSDOM doesn't ship visualViewport by default).
        delete (window as { visualViewport?: VisualViewport }).visualViewport;
    });

    it("renders four tabs with the canonical microcopy labels", () => {
        renderBar();
        expect(screen.getByText(microcopy.nav.tabs.boards)).toBeInTheDocument();
        expect(screen.getByText(microcopy.nav.tabs.inbox)).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.nav.tabs.copilot)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.nav.tabs.profile)
        ).toBeInTheDocument();
    });

    it("renders inside a <nav> landmark with the Primary aria-label", () => {
        renderBar();
        const nav = screen.getByRole("navigation", {
            name: microcopy.nav.primaryLandmarkLabel
        });
        expect(nav).toBeInTheDocument();
    });

    it("marks the active tab with aria-current='page' when on /projects", () => {
        renderBar("/projects");
        const boards = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.boards, "i")
        });
        expect(boards).toHaveAttribute("aria-current", "page");
    });

    it("keeps the Boards tab active when on a nested /projects/:id/board route", () => {
        renderBar("/projects/p1/board");
        const boards = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.boards, "i")
        });
        expect(boards).toHaveAttribute("aria-current", "page");
    });

    it("marks the Inbox tab active when on /inbox", () => {
        renderBar("/inbox");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        expect(inbox).toHaveAttribute("aria-current", "page");
    });

    it("marks the Copilot tab active when on /copilot", () => {
        renderBar("/copilot");
        const copilot = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.copilot, "i")
        });
        expect(copilot).toHaveAttribute("aria-current", "page");
    });

    it("marks the Profile tab active when on /settings", () => {
        renderBar("/settings");
        const profile = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.profile, "i")
        });
        expect(profile).toHaveAttribute("aria-current", "page");
    });

    it("clicking a tab forces a real document navigation to the target route", async () => {
        const user = userEvent.setup();
        renderBar("/projects");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        await user.click(inbox);
        expect(mockedNativeNavigate).toHaveBeenCalledWith("/inbox");
        expect(mockedNativeNavigate).toHaveBeenCalledTimes(1);
    });

    it("does not force a navigation when the user clicks the active tab", async () => {
        const user = userEvent.setup();
        renderBar("/inbox");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        await user.click(inbox);
        expect(mockedNativeNavigate).not.toHaveBeenCalled();
    });

    it("treats nested /projects routes as the active Boards tab (no-op click)", async () => {
        const user = userEvent.setup();
        renderBar("/projects/p1/board");
        const boards = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.boards, "i")
        });
        await user.click(boards);
        expect(mockedNativeNavigate).not.toHaveBeenCalled();
    });

    it("forces navigation from a nested /projects route to a sibling tab (board page bug fix)", async () => {
        const user = userEvent.setup();
        // The reported bug: clicking a BottomTabBar tab from
        // `/projects/:projectId/board` updated the URL but the page
        // stayed on the board until refresh. The fix routes through
        // `nativeNavigate` so the document reloads against the new URL.
        renderBar("/projects/p1/board");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        await user.click(inbox);
        expect(mockedNativeNavigate).toHaveBeenCalledWith("/inbox");
    });

    it("lets modifier-clicks fall through to the anchor href (new-tab affordance)", () => {
        renderBar("/projects");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        // userEvent doesn't expose modifier-state on click, but
        // fireEvent does. Cmd/Ctrl-click must not call nativeNavigate.
        fireEvent.click(inbox, { metaKey: true });
        expect(mockedNativeNavigate).not.toHaveBeenCalled();
        fireEvent.click(inbox, { ctrlKey: true });
        expect(mockedNativeNavigate).not.toHaveBeenCalled();
        fireEvent.click(inbox, { shiftKey: true });
        expect(mockedNativeNavigate).not.toHaveBeenCalled();
    });

    it("keeps the rendered anchor href so middle-click and copy-link still work", () => {
        renderBar("/projects");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        // NavLink resolves `to` to an `href` attribute on the anchor.
        // Verify it matches the tab's destination so right-click "Copy
        // link" and middle-click "Open in new tab" work without
        // round-tripping through `nativeNavigate`.
        expect(inbox).toHaveAttribute("href", "/inbox");
    });

    it("supports arrow-key navigation between tabs", () => {
        renderBar("/projects");
        const tabs = screen.getAllByRole("link");
        tabs[0]?.focus();
        fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
        expect(tabs[1]).toHaveFocus();
        fireEvent.keyDown(tabs[1]!, { key: "ArrowRight" });
        expect(tabs[2]).toHaveFocus();
        fireEvent.keyDown(tabs[2]!, { key: "ArrowLeft" });
        expect(tabs[1]).toHaveFocus();
        fireEvent.keyDown(tabs[1]!, { key: "End" });
        expect(tabs[tabs.length - 1]).toHaveFocus();
        fireEvent.keyDown(tabs[tabs.length - 1]!, { key: "Home" });
        expect(tabs[0]).toHaveFocus();
    });

    it("wraps arrow navigation past the last tab back to the first", () => {
        renderBar("/projects");
        const tabs = screen.getAllByRole("link");
        tabs[tabs.length - 1]?.focus();
        fireEvent.keyDown(tabs[tabs.length - 1]!, { key: "ArrowRight" });
        expect(tabs[0]).toHaveFocus();
        tabs[0]?.focus();
        fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
        expect(tabs[tabs.length - 1]).toHaveFocus();
    });

    it("hides the bar when the soft keyboard raises (visualViewport shrinks below ratio with input focused)", () => {
        // The production handler fires on both `resize` and `scroll`,
        // and requires an input to be focused before treating a viewport
        // shrink as the keyboard. Capture the listener callback the
        // component installs so we can drive the predicate end-to-end.
        const listeners: Array<() => void> = [];
        const mockViewport = {
            height: 700,
            width: 375,
            addEventListener: (event: string, cb: () => void) => {
                if (event === "resize" || event === "scroll")
                    listeners.push(cb);
            },
            removeEventListener: jest.fn()
        };
        Object.defineProperty(window, "visualViewport", {
            configurable: true,
            value: mockViewport
        });
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 700
        });

        renderBar();
        const nav = screen.getByTestId("bottom-tab-bar");
        // Tall viewport + no input focused → bar visible.
        expect(nav).toHaveAttribute("aria-hidden", "false");

        // Focus a text input and shrink the visual viewport, then fire
        // the captured handler. The bar should hide.
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        mockViewport.height = 300;
        act(() => {
            listeners.forEach((cb) => cb());
        });
        expect(nav).toHaveAttribute("aria-hidden", "true");

        // Restore the tall viewport (keyboard dismisses) → bar re-shows.
        mockViewport.height = 700;
        act(() => {
            listeners.forEach((cb) => cb());
        });
        expect(nav).toHaveAttribute("aria-hidden", "false");
        document.body.removeChild(input);
    });

    it("ignores a viewport shrink when no input is focused (URL-bar collapse, not keyboard)", () => {
        // Chrome Android collapses the URL bar on scroll, shrinking
        // visualViewport by ~56–100 px. Without an input focused that
        // is not the keyboard and we must keep the bar visible.
        const listeners: Array<() => void> = [];
        const mockViewport = {
            height: 600,
            width: 375,
            addEventListener: (event: string, cb: () => void) => {
                if (event === "resize" || event === "scroll")
                    listeners.push(cb);
            },
            removeEventListener: jest.fn()
        };
        Object.defineProperty(window, "visualViewport", {
            configurable: true,
            value: mockViewport
        });
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 700
        });

        renderBar();
        act(() => {
            listeners.forEach((cb) => cb());
        });
        const nav = screen.getByTestId("bottom-tab-bar");
        // 600 / 700 ≈ 0.86 > 0.75, AND no input focused → still visible.
        expect(nav).toHaveAttribute("aria-hidden", "false");
    });

    it("keeps the bar visible when visualViewport is undefined", () => {
        renderBar();
        const nav = screen.getByTestId("bottom-tab-bar");
        expect(nav).toHaveAttribute("aria-hidden", "false");
    });
});
