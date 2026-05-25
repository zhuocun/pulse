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

/*
 * Collect every interactive tab — the four route NavLinks plus the
 * Search action <button> — in DOM order. The roving arrow-key handler
 * walks all of them, so the keyboard tests assert against this merged,
 * document-ordered list rather than `getAllByRole("link")` (which
 * would silently drop the button) or `getAllByRole("button")` (which
 * would drop the links).
 */
const allTabs = (): HTMLElement[] => {
    const links = screen.getAllByRole("link");
    const buttons = screen.queryAllByRole("button");
    return [...links, ...buttons].sort((a, b) =>
        // Node.compareDocumentPosition returns a bitmask;
        // DOCUMENT_POSITION_FOLLOWING (4) is set when `b` follows `a`.
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
};

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

    it("renders five tabs with the canonical microcopy labels (4 routes + Search action)", () => {
        renderBar();
        expect(screen.getByText(microcopy.nav.tabs.boards)).toBeInTheDocument();
        expect(screen.getByText(microcopy.nav.tabs.inbox)).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.nav.tabs.copilot)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.nav.tabs.profile)
        ).toBeInTheDocument();
        // Phase 6 Wave 7 — the Search action tab. It's a <button>, not
        // a route link, so it surfaces by its label text alongside the
        // four destination tabs.
        expect(screen.getByText(microcopy.nav.tabs.search)).toBeInTheDocument();
    });

    it("renders exactly four route links (Search is an action button, not a link)", () => {
        renderBar();
        // The four destinations are NavLinks; the Search tab is a
        // <button>, so getAllByRole("link") must still return four.
        expect(screen.getAllByRole("link")).toHaveLength(4);
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

    /*
     * Phase 6 Wave 7 — the Search action tab. It opens the existing
     * command palette via a `commandPalette:open` CustomEvent (the
     * App.tsx listener handles it; on phone that's the Wave 4
     * bottom-anchored search) and is the first/only production trigger
     * for that event — closing the gap where phone users had no
     * palette launcher (Cmd/Ctrl+K only). It is NOT a route: it never
     * navigates, never carries aria-current, and the morph indicator
     * never sits on it.
     */
    describe("Search action tab (Phase 6 Wave 7)", () => {
        it("renders the Search tab as a <button>, not a route link", () => {
            renderBar();
            const search = screen.getByRole("button", {
                name: new RegExp(microcopy.nav.tabs.search, "i")
            });
            expect(search).toBeInTheDocument();
            expect(search).toHaveAttribute("type", "button");
            // It must NOT surface as a link (no href / NavLink).
            expect(
                screen.queryByRole("link", {
                    name: new RegExp(microcopy.nav.tabs.search, "i")
                })
            ).toBeNull();
        });

        it("dispatches a commandPalette:open event when activated and does NOT navigate", async () => {
            const user = userEvent.setup();
            const handler = jest.fn();
            window.addEventListener("commandPalette:open", handler);
            renderBar("/projects");
            const search = screen.getByRole("button", {
                name: new RegExp(microcopy.nav.tabs.search, "i")
            });
            await user.click(search);
            expect(handler).toHaveBeenCalledTimes(1);
            // It's an action tab — must never route through nativeNavigate.
            expect(mockedNativeNavigate).not.toHaveBeenCalled();
            window.removeEventListener("commandPalette:open", handler);
        });

        it("fires the same haptic 'tap' the route tabs use on activation", async () => {
            // useHaptic maps "tap" → a 10ms single pulse via
            // navigator.vibrate; install a spy so we can assert parity
            // with the route tabs' haptic.
            const spy = jest.fn().mockReturnValue(true);
            (navigator as unknown as { vibrate?: typeof spy }).vibrate = spy;
            const user = userEvent.setup();
            renderBar("/projects");
            const search = screen.getByRole("button", {
                name: new RegExp(microcopy.nav.tabs.search, "i")
            });
            await user.click(search);
            expect(spy).toHaveBeenCalledWith(10);
            delete (navigator as unknown as { vibrate?: typeof spy }).vibrate;
        });

        it("is keyboard-activatable (Enter / Space dispatch the open event)", async () => {
            const user = userEvent.setup();
            const handler = jest.fn();
            window.addEventListener("commandPalette:open", handler);
            renderBar("/projects");
            const search = screen.getByRole("button", {
                name: new RegExp(microcopy.nav.tabs.search, "i")
            });
            search.focus();
            await user.keyboard("{Enter}");
            await user.keyboard(" ");
            // Both Enter and Space activate a native <button>.
            expect(handler).toHaveBeenCalledTimes(2);
            window.removeEventListener("commandPalette:open", handler);
        });

        it.each(["/projects", "/inbox", "/copilot", "/settings"])(
            "never marks the Search tab active (no aria-current) on %s while the route tab still is",
            (path) => {
                renderBar(path);
                const search = screen.getByRole("button", {
                    name: new RegExp(microcopy.nav.tabs.search, "i")
                });
                // The action tab carries no route, so it must never be
                // aria-current regardless of the active pathname.
                expect(search).not.toHaveAttribute("aria-current");
                // And exactly one route link is active (the indicator's
                // anchor), so the bar still reflects "you are here".
                const activeLinks = screen
                    .getAllByRole("link")
                    .filter(
                        (link) => link.getAttribute("aria-current") === "page"
                    );
                expect(activeLinks).toHaveLength(1);
            }
        );

        it("positions the morph indicator on the active ROUTE slot, never the Search slot, with the 5-tab geometry", () => {
            // Inbox is slot index 2 in the 5-tab array (Boards=0,
            // Search=1, Inbox=2). The indicator's left offset must use
            // index 2 — proving the never-active Search slot (index 1)
            // doesn't shift the indicator math — and its width must
            // divide the inner track by 5, not 4.
            const { container } = renderBar("/inbox");
            const indicator = container.querySelector(
                "[data-active-indicator]"
            ) as HTMLElement;
            expect(indicator).not.toBeNull();
            const left = indicator.style.getPropertyValue("--indicator-left");
            const width = indicator.style.getPropertyValue("--indicator-width");
            // Width slices the inner track into 5 equal slots.
            expect(width).toContain("/ 5");
            // Left advances by index 2 (the Inbox route slot), so the
            // indicator sits on Inbox — NOT on Search (index 1).
            expect(left).toContain("2 *");
            expect(left).toContain("/ 5");
            // Indicator is visible (not display:none) when a route matches.
            expect(indicator.style.display).not.toBe("none");
        });

        it("hides the morph indicator entirely when no route tab matches (e.g. an unknown path)", () => {
            // On a path that matches no route tab, activeIndex is -1 and
            // the indicator collapses to display:none — it must never
            // fall back onto the Search action slot.
            const { container } = renderBar("/totally-unknown");
            const indicator = container.querySelector(
                "[data-active-indicator]"
            ) as HTMLElement;
            expect(indicator.style.display).toBe("none");
            // No route link is active either.
            const activeLinks = screen
                .getAllByRole("link")
                .filter((link) => link.getAttribute("aria-current") === "page");
            expect(activeLinks).toHaveLength(0);
        });
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

    it("supports arrow-key navigation across all five tabs (links + Search button) in DOM order", () => {
        renderBar("/projects");
        // Roving focus walks every interactive tab — the four NavLinks
        // AND the Search action button — in DOM order, so collect both
        // roles and sort by document position.
        const tabs = allTabs();
        expect(tabs).toHaveLength(5);
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

    it("includes the Search action button in the arrow-key roving order", () => {
        renderBar("/projects");
        const tabs = allTabs();
        const search = screen.getByRole("button", {
            name: new RegExp(microcopy.nav.tabs.search, "i")
        });
        // Search sits in slot index 1 (right after Boards), so a single
        // ArrowRight from the first tab lands focus on the button.
        expect(tabs[1]).toBe(search);
        tabs[0]?.focus();
        fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
        expect(search).toHaveFocus();
    });

    it("wraps arrow navigation past the last tab back to the first", () => {
        renderBar("/projects");
        const tabs = allTabs();
        tabs[tabs.length - 1]?.focus();
        fireEvent.keyDown(tabs[tabs.length - 1]!, { key: "ArrowRight" });
        expect(tabs[0]).toHaveFocus();
        tabs[0]?.focus();
        fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
        expect(tabs[tabs.length - 1]).toHaveFocus();
    });

    it("hides the bar via `inert` when the soft keyboard raises (visualViewport shrinks below ratio with input focused)", () => {
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
        // Tall viewport + no input focused → bar visible (no `inert`).
        expect(nav).not.toHaveAttribute("inert");

        // Focus a text input and shrink the visual viewport, then fire
        // the captured handler. The bar should hide.
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        mockViewport.height = 300;
        act(() => {
            listeners.forEach((cb) => cb());
        });
        expect(nav).toHaveAttribute("inert");

        // Restore the tall viewport (keyboard dismisses) → bar re-shows.
        mockViewport.height = 700;
        act(() => {
            listeners.forEach((cb) => cb());
        });
        expect(nav).not.toHaveAttribute("inert");
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
        expect(nav).not.toHaveAttribute("inert");
    });

    it("keeps the bar visible (no `inert`) when visualViewport is undefined", () => {
        renderBar();
        const nav = screen.getByTestId("bottom-tab-bar");
        expect(nav).not.toHaveAttribute("inert");
    });

    /*
     * Phase 5 "Liquid Glass" Wave 2 T3 — Liquid chrome recipe upgrade.
     * The bottom-tab bar gains:
     *   1. Specular rim (::before / ::after gradient layers).
     *   2. Gel-flex micro-press on TabLink (each NavLink tab yields
     *      under press; mirrors the header IconButton / PillTrigger
     *      gel-flex so every interactive chrome surface has parity).
     *   3. data-glass-context="true" marker.
     *
     * No scroll-edge dissolve here — the bar is pinned to the
     * viewport bottom rather than sitting over content scrolled past
     * it. The pseudo-element / transition assertions walk the
     * styled-component sheet directly because jsdom does not
     * introspect ::before / ::after via getComputedStyle.
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

        it('marks the nav root with data-glass-context="true"', () => {
            renderBar();
            const nav = screen.getByTestId("bottom-tab-bar");
            expect(nav.getAttribute("data-glass-context")).toBe("true");
        });

        it("emits a ::before specular-rim layer with --glass-specular-top", () => {
            renderBar();
            const css = sheetText();
            expect(css).toMatch(
                /::before[^}]*background:\s*var\(--glass-specular-top\)/
            );
        });

        it("emits a ::after companion shadow layer with --glass-specular-bottom", () => {
            renderBar();
            const css = sheetText();
            expect(css).toMatch(
                /::after[^}]*background:\s*var\(--glass-specular-bottom\)/
            );
        });

        it("does NOT ship a scroll-edge mask on the bottom-tab bar (pinned to viewport bottom, not over scrolling content)", () => {
            renderBar();
            const css = sheetText();
            // The header / projectDetail TopBar carry a 12px scroll-edge
            // dissolve mask; the bar is fixed at viewport bottom so the
            // mask would have no semantic meaning. Assert it is absent
            // so a future refactor doesn't accidentally add one.
            expect(css).not.toMatch(
                /pulse-tabbar[^}]*mask-image:\s*linear-gradient/
            );
        });

        it("applies gel-flex transform recipe to TabLink", () => {
            renderBar();
            const css = sheetText();
            expect(css).toMatch(/transform[^;]*var\(--motion-gel-flex/);
            expect(css).toMatch(/:active[^}]*transform:\s*scale\(0\.97\)/);
        });

        it("respects prefers-reduced-motion by neutralizing the transition + active scale", () => {
            renderBar();
            const css = sheetText();
            expect(css).toMatch(/prefers-reduced-motion[^}]*reduce/);
            expect(css).toMatch(/transform:\s*none/);
        });

        it("respects prefers-reduced-transparency by dropping the rim backgrounds", () => {
            renderBar();
            const css = sheetText();
            expect(css).toMatch(/prefers-reduced-transparency[^}]*reduce/);
        });
    });

    /*
     * Phase 6 Wave 2 — floating capsule geometry, haptic feedback,
     * minimize-on-scroll, selection morph indicator. The sheet-text
     * inspection pattern matches the Wave 2 T3 block above: jsdom
     * doesn't introspect computed styles for styled-components, so
     * we walk the styled-component stylesheet directly.
     */
    describe("Phase 6 Wave 2 — floating capsule, haptic, minimize-on-scroll", () => {
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

        type VibrateFn = Navigator["vibrate"];
        type VibrateSurface = { vibrate?: VibrateFn };

        const installVibrate = (): jest.Mock<boolean, [number | number[]]> => {
            const spy = jest.fn().mockReturnValue(true) as jest.Mock<
                boolean,
                [number | number[]]
            >;
            (navigator as unknown as VibrateSurface).vibrate =
                spy as unknown as VibrateFn;
            return spy;
        };

        const uninstallVibrate = (): void => {
            delete (navigator as unknown as VibrateSurface).vibrate;
        };

        const fireScroll = () => {
            window.dispatchEvent(new Event("scroll"));
        };

        const setScrollY = (y: number) => {
            Object.defineProperty(window, "scrollY", {
                configurable: true,
                value: y
            });
        };

        let nowSpy: jest.SpyInstance<number, []>;
        let nowMs = 0;

        beforeEach(() => {
            setScrollY(0);
            nowMs = 1_000_000;
            nowSpy = jest.spyOn(Date, "now").mockImplementation(() => nowMs);
        });

        afterEach(() => {
            nowSpy.mockRestore();
            uninstallVibrate();
            delete (document as Partial<Document>).startViewTransition;
            setScrollY(0);
        });

        it("renders at floating geometry (pill border-radius, fixed, centred via translateX)", () => {
            renderBar();
            const css = sheetText();
            // Pill corners — radius.pill resolves to 999px.
            expect(css).toMatch(/border-radius:\s*999px/);
            // Centred horizontally and detached from viewport bottom
            // via `bottom: max(...)`.
            expect(css).toMatch(/left:\s*50%/);
            expect(css).toMatch(/translateX\(-50%\)/);
            expect(css).toMatch(/bottom:\s*max\(/);
            // Width clamp — uses `min(calc(100% - 32px), 480px)` so the
            // bar caps at 480 px on tablets in portrait.
            expect(css).toMatch(/width:\s*min\(/);
            expect(css).toMatch(/480px/);
        });

        it("emits the new opacity+over-translate hide pattern when keyboard is open (not plain translateY(100%))", () => {
            renderBar();
            const css = sheetText();
            // Hide pattern over-translates beyond safe-area inset and
            // drops opacity. The old translateY(100%) literal must
            // not appear because the floating geometry leaves the bar
            // peeking above the safe-area inset.
            expect(css).toMatch(
                /translateY\(calc\(100% \+ env\(safe-area-inset-bottom\)/
            );
            expect(css).toMatch(/opacity:\s*0/);
            expect(css).toMatch(/pointer-events:\s*none/);
        });

        it("renders the selection morph indicator with a stable view-transition-name", () => {
            renderBar();
            const css = sheetText();
            expect(css).toMatch(/view-transition-name:\s*pulse-tab-indicator/);
        });

        it("tags each tab (route links AND the Search button) with a per-tab view-transition-name so the indicator can morph between them", () => {
            renderBar();
            // Walk every interactive tab — including the Search action
            // button — since each carries an inline style with its
            // `view-transition-name: pulse-tab-<labelKey>`.
            const tabs = allTabs();
            const names = tabs.map(
                (tab) =>
                    tab.style.getPropertyValue("view-transition-name") || ""
            );
            expect(names).toEqual(
                expect.arrayContaining([
                    "pulse-tab-boards",
                    "pulse-tab-search",
                    "pulse-tab-inbox",
                    "pulse-tab-copilot",
                    "pulse-tab-profile"
                ])
            );
        });

        it("fires haptic vibrate('tap') when activating a NEW tab", async () => {
            const vibrate = installVibrate();
            const user = userEvent.setup();
            renderBar("/projects");
            const inbox = screen.getByRole("link", {
                name: new RegExp(microcopy.nav.tabs.inbox, "i")
            });
            await user.click(inbox);
            // useHaptic maps "tap" → 10ms single pulse.
            expect(vibrate).toHaveBeenCalledWith(10);
            expect(vibrate).toHaveBeenCalledTimes(1);
        });

        it("does NOT fire haptic when re-tapping the active tab", async () => {
            const vibrate = installVibrate();
            const user = userEvent.setup();
            renderBar("/inbox");
            const inbox = screen.getByRole("link", {
                name: new RegExp(microcopy.nav.tabs.inbox, "i")
            });
            await user.click(inbox);
            // Same-tab click is a no-op — no haptic, no navigation.
            expect(vibrate).not.toHaveBeenCalled();
            expect(mockedNativeNavigate).not.toHaveBeenCalled();
        });

        it("does NOT fire haptic on modifier-clicks (new-tab affordance)", () => {
            const vibrate = installVibrate();
            renderBar("/projects");
            const inbox = screen.getByRole("link", {
                name: new RegExp(microcopy.nav.tabs.inbox, "i")
            });
            fireEvent.click(inbox, { metaKey: true });
            expect(vibrate).not.toHaveBeenCalled();
        });

        it("sets data-minimized='true' on the bar when scrolling DOWN past the threshold", () => {
            renderBar();
            const nav = screen.getByTestId("bottom-tab-bar");
            // Initial state — not minimized.
            expect(nav.getAttribute("data-minimized")).toBe("false");
            // Scroll past the threshold (50 px).
            act(() => {
                setScrollY(80);
                fireScroll();
            });
            expect(nav.getAttribute("data-minimized")).toBe("true");
        });

        it("restores data-minimized='false' on the bar when scrolling UP", () => {
            renderBar();
            const nav = screen.getByTestId("bottom-tab-bar");
            // Scroll down to minimize.
            act(() => {
                setScrollY(120);
                fireScroll();
            });
            expect(nav.getAttribute("data-minimized")).toBe("true");
            // Wait past the min-state-duration lockout, then scroll up.
            act(() => {
                nowMs += 400;
                setScrollY(20);
                fireScroll();
            });
            expect(nav.getAttribute("data-minimized")).toBe("false");
        });

        it("does NOT toggle on small scroll deltas below the threshold (hysteresis)", () => {
            renderBar();
            const nav = screen.getByTestId("bottom-tab-bar");
            // 30 px is below the 50 px threshold.
            act(() => {
                setScrollY(30);
                fireScroll();
            });
            expect(nav.getAttribute("data-minimized")).toBe("false");
        });

        it("respects prefers-reduced-motion by neutralizing the label-fade transition while still toggling the state", () => {
            renderBar();
            const css = sheetText();
            // The TabLabel rule carries a transition: opacity ... clause
            // that the reduced-motion media query neutralizes; this
            // assertion checks the rule exists in the sheet so a future
            // refactor doesn't accidentally drop the safety net.
            expect(css).toMatch(/prefers-reduced-motion[^}]*reduce/);
            // The state-toggle remains observable — minimizing still
            // sets data-minimized="true" so the layout change is
            // discoverable to AT users.
            const nav = screen.getByTestId("bottom-tab-bar");
            act(() => {
                setScrollY(80);
                fireScroll();
            });
            expect(nav.getAttribute("data-minimized")).toBe("true");
        });

        it("pauses minimize state updates while a view transition is in flight (no flicker)", () => {
            // Mock startViewTransition with a never-resolving `finished`
            // so the gate stays closed; a scroll during that window
            // must NOT flip the minimize state.
            //
            // The promise-resolver capture uses an explicit type
            // annotation on the IIFE result rather than `let
            // resolveFinished: ... = null` because TypeScript can't
            // see through the Promise constructor's synchronous
            // callback and narrows the captured ref to `null` (which
            // would block the optional-chain call at end of test).
            const resolverCapture = {
                resolve: (() => undefined) as () => void
            };
            const finished = new Promise<void>((resolve) => {
                resolverCapture.resolve = resolve;
            });
            const startSpy = jest.fn().mockReturnValue({ finished });
            (
                document as unknown as {
                    startViewTransition?: typeof startSpy;
                }
            ).startViewTransition = startSpy;

            renderBar();
            const nav = screen.getByTestId("bottom-tab-bar");
            // Trigger a transition.
            act(() => {
                (
                    document as unknown as {
                        startViewTransition?: typeof startSpy;
                    }
                ).startViewTransition?.(() => undefined);
            });
            // Scroll past the threshold during the transition.
            act(() => {
                setScrollY(200);
                fireScroll();
            });
            // The gate should suppress the minimize flip.
            expect(nav.getAttribute("data-minimized")).toBe("false");

            // Cleanup the never-resolving promise so jest doesn't
            // complain about an open handle.
            resolverCapture.resolve();
        });

        it("hides the bar with the new opacity+over-translate pattern when useKeyboardOpen() returns true", () => {
            // Drive useKeyboardOpen → true by mocking visualViewport
            // and focusing an input (the canonical keyboard-up state).
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
            const input = document.createElement("input");
            document.body.appendChild(input);
            input.focus();
            mockViewport.height = 300;
            act(() => {
                listeners.forEach((cb) => cb());
            });
            // The bar is gated `inert` — confirms the keyboard-open
            // path is live and the bar is hidden via the new pattern.
            expect(nav).toHaveAttribute("inert");
            // The over-translate hide pattern is asserted in CSS above;
            // here we just confirm the prop wiring fires.
            document.body.removeChild(input);
        });
    });
});
