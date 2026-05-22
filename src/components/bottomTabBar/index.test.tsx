import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";

import BottomTabBar from ".";

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

    it("clicking a tab navigates to the target route", async () => {
        const user = userEvent.setup();
        renderBar("/projects");
        const inbox = screen.getByRole("link", {
            name: new RegExp(microcopy.nav.tabs.inbox, "i")
        });
        await user.click(inbox);
        // After navigation, the Inbox link now carries aria-current.
        expect(
            screen.getByRole("link", {
                name: new RegExp(microcopy.nav.tabs.inbox, "i")
            })
        ).toHaveAttribute("aria-current", "page");
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

    it("hides the bar when the soft keyboard raises (visualViewport shrinks past threshold)", () => {
        // Simulate a visualViewport whose height has shrunk well below
        // window.innerHeight — the rough keyboard-open signal.
        const listeners: Array<() => void> = [];
        const mockViewport = {
            height: 300,
            width: 375,
            addEventListener: (event: string, cb: () => void) => {
                if (event === "resize") listeners.push(cb);
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
        // Initial render evaluates the keyboard predicate via handler() —
        // the bar should already be hidden (drop = 400 > 150).
        const nav = screen.getByTestId("bottom-tab-bar");
        expect(nav).toHaveAttribute("aria-hidden", "true");
    });

    it("keeps the bar visible when visualViewport is undefined", () => {
        renderBar();
        const nav = screen.getByTestId("bottom-tab-bar");
        expect(nav).toHaveAttribute("aria-hidden", "false");
    });
});
