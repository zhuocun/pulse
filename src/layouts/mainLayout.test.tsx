/* eslint-disable global-require */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../constants/microcopy";

import MainLayout from "./mainLayout";

jest.mock("../components/header", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("header", null, "App Header")
    };
});
jest.mock("../components/projectModal", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("div", null, "Project Modal")
    };
});
jest.mock("../components/bottomTabBar", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "nav",
                { "data-testid": "bottom-tab-bar-mock" },
                "BottomTabBar"
            )
    };
});
/*
 * Mock TabBarAccessoryMount as a sentinel marker so we can assert it's
 * mounted exactly once (the underlying primitive warns + replaces on
 * duplicate mounts, but the cleaner contract is "the layout reserves
 * one and only one slot"). We mock the named export shape because the
 * layout imports `{ TabBarAccessoryMount }` from the module barrel.
 */
jest.mock("../components/tabBarAccessory", () => {
    const React = require("react");
    return {
        __esModule: true,
        TabBarAccessoryMount: () =>
            React.createElement(
                "div",
                { "data-testid": "tab-bar-accessory-mount-mock" },
                "TabBarAccessoryMount"
            ),
        default: ({ children }: { children: React.ReactNode }) => children
    };
});

// Mock the environment module so individual tests can flip the
// bottomNavEnabled flag and matchMedia so AntD's Grid.useBreakpoint can
// resolve to phone-mode (every query returns matches=false → md=false).
jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "/api/v1",
        aiBaseUrl: "",
        aiEnabled: false,
        aiUseLocalEngine: true,
        bottomNavEnabled: true
    }
}));

const envMod = jest.requireMock("../constants/env") as {
    default: { bottomNavEnabled: boolean };
};

/**
 * Phone mode = the `(pointer: coarse)` query matches. Other queries
 * (AntD's width-based Grid.useBreakpoint) report `false` so the
 * `useIsPhoneChrome` hook resolves to `true` without dragging in
 * unrelated AntD layout signals.
 */
const installMatchMediaPhone = () => {
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

/**
 * Desktop mode = `(pointer: coarse)` does NOT match (fine pointer,
 * mouse) so `useIsPhoneChrome` resolves to `false` and the bar does
 * not mount regardless of viewport width. AntD's width queries return
 * `true` here so any Grid-driven chrome elsewhere still reads as
 * "desktop wide".
 */
const installMatchMediaDesktop = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: query !== "(pointer: coarse)",
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

describe("MainLayout", () => {
    beforeEach(() => {
        envMod.default.bottomNavEnabled = true;
        installMatchMediaPhone();
    });

    afterEach(() => {
        // Reset the matchMedia mock value to a benign stub between
        // tests so a cross-file spec that Jest schedules on the same
        // worker doesn't inherit our phone/desktop predicates. The
        // property is defined `writable: true` above so we update the
        // value via assignment rather than another defineProperty
        // (which would reject a configurable=false→true descriptor
        // change in JSDOM).
        (window as { matchMedia?: typeof window.matchMedia }).matchMedia =
            undefined;
    });

    it("renders the header, main outlet, and project modal", () => {
        const { container } = render(
            <MemoryRouter initialEntries={["/projects"]}>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route
                            path="/projects"
                            element={<div>Project workspace</div>}
                        />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText("App Header")).toBeInTheDocument();
        expect(screen.getByText("Project workspace")).toBeInTheDocument();
        expect(screen.getByText("Project Modal")).toBeInTheDocument();
        expect(container.firstElementChild).toHaveStyle({
            display: "grid"
        });
        expect(container.firstElementChild?.tagName.toLowerCase()).toBe("div");
        expect(container.querySelector("main")).toHaveStyle({
            display: "flex"
        });
    });

    // The skip link is hidden until the user tabs to it (WCAG 2.4.1 Bypass
    // Blocks). It MUST keep `pointer-events: none` until focus, otherwise its
    // 1×1 hit target sits above the stacked chrome and steals clicks that
    // belong to header buttons. Pairs the styled-anchor invariant with the
    // first-tab-focus contract that the deleted strict file used to assert.
    it("renders a skip link that is non-interactive until tab focuses it", async () => {
        render(
            <MemoryRouter>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route index element={<div>page</div>} />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        const skip = screen.getByRole("link", {
            name: microcopy.a11y.skipToMainContent
        });
        expect(skip).toHaveAttribute("href", "#main-content");
        expect(skip).toHaveStyle({ pointerEvents: "none" });
        expect(skip).not.toHaveFocus();

        await userEvent.tab();
        expect(skip).toHaveFocus();
    });

    // Phase 3 A3 — BottomTabBar mount gating. The bar must appear when
    // the user is on a coarse-pointer surface (phone, touchscreen
    // laptop) AND the env flag is on; otherwise it must not mount. The
    // mount-gate is the shared `useIsPhoneChrome` predicate, aligned
    // with the Header's right-cluster demote-gate. The mock above
    // replaces the real bar with a sentinel <nav> so we can assert
    // mount/no-mount without dragging in NavLink routing concerns.
    describe("BottomTabBar mount gating", () => {
        it("mounts the bar on coarse-pointer surfaces when the flag is on", () => {
            installMatchMediaPhone();
            envMod.default.bottomNavEnabled = true;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            expect(
                screen.getByTestId("bottom-tab-bar-mock")
            ).toBeInTheDocument();
        });

        it("does NOT mount the bar on fine-pointer surfaces (mouse / trackpad)", () => {
            installMatchMediaDesktop();
            envMod.default.bottomNavEnabled = true;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            expect(
                screen.queryByTestId("bottom-tab-bar-mock")
            ).not.toBeInTheDocument();
        });

        it("does NOT mount the bar when the env flag is off, even on coarse-pointer surfaces", () => {
            installMatchMediaPhone();
            envMod.default.bottomNavEnabled = false;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            expect(
                screen.queryByTestId("bottom-tab-bar-mock")
            ).not.toBeInTheDocument();
        });
    });

    /*
     * Phase 6 Wave 2 — TabBarAccessoryMount wiring. The slot must
     * mount exactly once on phone chassis (no double-mount, which the
     * primitive warns about), it must NOT mount on desktop / fine-
     * pointer surfaces (no accessory chrome without the bar), and the
     * Main region must reserve clearance for the floating bar +
     * bottom gap so scroll content never tucks underneath the
     * floating pill.
     */
    describe("TabBarAccessoryMount + body padding (Phase 6 Wave 2)", () => {
        it("mounts the TabBarAccessoryMount exactly once on phone chassis", () => {
            installMatchMediaPhone();
            envMod.default.bottomNavEnabled = true;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            const mounts = screen.getAllByTestId(
                "tab-bar-accessory-mount-mock"
            );
            expect(mounts).toHaveLength(1);
        });

        it("mounts the accessory slot BEFORE the BottomTabBar in render order (DOM order matches visual order)", () => {
            installMatchMediaPhone();
            envMod.default.bottomNavEnabled = true;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            const accessory = screen.getByTestId(
                "tab-bar-accessory-mount-mock"
            );
            const bar = screen.getByTestId("bottom-tab-bar-mock");
            // The accessory chrome must paint visually ABOVE the bar.
            // Both are position: fixed, so DOM order alone doesn't
            // control stacking (z-index does); but our render order
            // matches the visual contract so future stacking changes
            // stay self-documenting.
            const position = accessory.compareDocumentPosition(bar);
            // Node.DOCUMENT_POSITION_FOLLOWING === 4 — accessory comes
            // first, bar comes after.
            expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING
            );
        });

        it("does NOT mount the accessory slot on desktop (no accessory chrome without the bar)", () => {
            installMatchMediaDesktop();
            envMod.default.bottomNavEnabled = true;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            expect(
                screen.queryByTestId("tab-bar-accessory-mount-mock")
            ).not.toBeInTheDocument();
        });

        it("reserves body padding for the floating bar + bottom gap (no content tucking underneath)", () => {
            installMatchMediaPhone();
            envMod.default.bottomNavEnabled = true;
            const { container } = render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            const main = container.querySelector("main");
            // The padding-bottom token references env(safe-area-inset-
            // bottom) which jsdom resolves to 0px, so we inspect the
            // styled-component sheet for the formula instead of
            // getComputedStyle. The padding adds the bar height (64),
            // the bottom gap (space.lg = 24), breathing room (space.sm = 12),
            // and one viewport-edge buffer (space.xxl = 48) on top of the
            // safe-area inset.
            const sheets = Array.from(document.styleSheets)
                .map((sheet) => {
                    try {
                        return Array.from(sheet.cssRules)
                            .map((rule) => rule.cssText)
                            .join("\n");
                    } catch {
                        return "";
                    }
                })
                .join("\n");
            expect(main).not.toBeNull();
            // The formula includes env(safe-area-inset-bottom)
            // AND the additional 24+12+48 px gap.
            expect(sheets).toMatch(
                /calc\(64px \+ env\(safe-area-inset-bottom\) \+ 24px \+ 12px \+ 48px\)/
            );
        });

        it("does NOT mount the accessory slot when the env flag is off (rollback path)", () => {
            installMatchMediaPhone();
            envMod.default.bottomNavEnabled = false;
            render(
                <MemoryRouter>
                    <Routes>
                        <Route element={<MainLayout />}>
                            <Route index element={<div>page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            );
            expect(
                screen.queryByTestId("tab-bar-accessory-mount-mock")
            ).not.toBeInTheDocument();
        });
    });
});
