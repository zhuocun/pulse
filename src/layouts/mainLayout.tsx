import { Suspense } from "react";
import { Outlet } from "react-router";

import { cn } from "@/lib/utils";

import BottomTabBar from "../components/bottomTabBar";
import CopilotDockHost from "../components/copilotDock/copilotDockHost";
import Header from "../components/header";
import OnboardingTour from "../components/onboardingTour";
import ProjectModal from "../components/projectModal";
import ShortcutHelp from "../components/shortcutHelp";
import { PageSpin } from "../components/status";
import { TabBarAccessoryMount } from "../components/tabBarAccessory";
import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";
import { space } from "../theme/tokens";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";

/*
 * When the bottom tab bar mounts (phone + flag on), reserve space so the
 * floating-position bar doesn't occlude the routed content. The 64 px figure
 * matches the bar's 56 px touch target + 8 px inner padding; on top of the
 * safe-area inset we add the Wave 2 capsule outset (space.lg + space.sm) and
 * one viewport-edge buffer (space.xxl) so scroll content never tucks under
 * the floating pill.
 */
const BOTTOM_NAV_PADDING = `calc(64px + env(safe-area-inset-bottom) + ${space.lg}px + ${space.sm}px + ${space.xxl}px)`;

/**
 * Application shell. Header + outlet + always-mounted ProjectModal drawer.
 *
 * The layout is a two-row grid (`auto 1fr`) so the header sizes to content
 * and `<main>` takes the rest. `grid-template-columns: minmax(0, 1fr)` is
 * required: an `auto` track grows to its widest descendant, so the board's
 * horizontally-scrolling kanban was stretching the track past the viewport
 * and clipping the header's right edge under `body { overflow-x: hidden }`.
 * The inner regions own scroll and the page reflows down to 320 px
 * (WCAG 1.4.10).
 */
const MainLayout = () => {
    /*
     * Bottom tab bar gating (Phase 3 A3). Two predicates compose:
     *   - `environment.bottomNavEnabled` is the rollback kill-switch
     *     (REACT_APP_BOTTOM_NAV_ENABLED=false brings back the
     *     header-only chrome without a code revert).
     *   - `useIsPhoneChrome()` reads `(pointer: coarse)`, the single
     *     source of truth shared with the Header's right-cluster
     *     demote-gate. Aligning both surfaces on the same predicate
     *     prevents the bar/header mismatch (touchscreen laptops were
     *     hiding the header right-cluster while refusing to mount the
     *     bar; small-window non-touch laptops were doing the inverse).
     */
    const isPhoneChrome = useIsPhoneChrome();
    const showBottomNav = environment.bottomNavEnabled && isPhoneChrome;

    return (
        // Transparent so the aurora mesh painted on body shows through; the
        // --pulse-bg-page variable still backs the body fallback under
        // prefers-reduced-transparency (see App.css).
        <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] bg-transparent text-page-text [min-height:100dvh]">
            {/*
             * Skip-to-content link (WCAG 2.4.1 Bypass Blocks). Hidden until
             * focused, then renders a high-contrast pill at the top of the
             * viewport. It sits above sticky chrome while translated
             * off-screen; pointer-events stay off until focus so its 1×1 hit
             * target never steals clicks that belong to header buttons.
             */}
            <a
                className={cn(
                    "pointer-events-none absolute left-sm top-sm z-[9999] -translate-y-[200%] rounded-md bg-brand px-md py-xs text-sm font-semibold text-white no-underline transition-transform duration-short ease-out",
                    "focus:pointer-events-auto focus:translate-y-0 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white",
                    "focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                )}
                href="#main-content"
            >
                {microcopy.a11y.skipToMainContent}
            </a>
            <Header />
            <main
                className="flex min-h-0 min-w-0 flex-col scroll-pt-[var(--header-height,64px)]"
                id="main-content"
                style={
                    showBottomNav
                        ? { paddingBottom: BOTTOM_NAV_PADDING }
                        : undefined
                }
                tabIndex={-1}
            >
                {/* Suspense lives inside the layout so the header + bottom
                 * tab bar stay mounted while a lazy page chunk fetches. */}
                <Suspense fallback={<PageSpin />}>
                    <Outlet />
                </Suspense>
            </main>
            <ProjectModal />
            {/*
             * Phase 4.4 — first-login onboarding tour. Mounted once in the
             * authenticated shell; it self-gates to a no-op when the user
             * is unauthenticated, on an auth page, or has already dismissed
             * it (the dismissed flag is persisted in localStorage). Honors
             * `prefers-reduced-motion` internally. Never blocks the app or
             * traps focus — closing / finishing / Esc all dismiss it.
             */}
            <OnboardingTour />
            {/*
             * Keyboard-shortcut help dialog (ui-todo §2.A.9, WCAG 3.2.6
             * Consistent Help). Self-manages its open state: it registers a
             * global `?` shortcut (suppressed while typing in a field) via
             * `useShortcut` and lists the `SHORTCUTS` catalog grouped by
             * scope. Mounted once here so the `?` hotkey works on every
             * authenticated route, mirroring how the OnboardingTour is a
             * single always-mounted overlay.
             */}
            <ShortcutHelp />
            {/*
             * R-A M1: persistent CopilotDock. Mounting the dock here
             * (above the routed `<Outlet />`) means navigating between
             * `/projects/p1/board` → `/projects/p2/board` no longer
             * tears the dock down — chat history, the brief cache, the
             * active tab, and the open/closed flag all survive the
             * route change. The host is a no-op when
             * `REACT_APP_COPILOT_DOCK_ENABLED` is unset, when AI is
             * globally off, when the URL has no `projectId`, or when
             * the current project has AI opted out per-project.
             *
             * The legacy `<AiChatDrawer>` / `<BoardBriefDrawer>` mounts
             * in `pages/board.tsx` remain behind the
             * `!copilotDockEnabled` branch for the rollback path; the
             * two surfaces never co-exist for a given user.
             */}
            <CopilotDockHost />
            {showBottomNav ? (
                <>
                    {/*
                     * Phase 6 Wave 2 — TabBarAccessory slot. Mount the
                     * portal host above the BottomTabBar in render
                     * order so the DOM order matches the visual order
                     * (accessory chrome sits above the bar). The slot
                     * is a portal-rendered fixed-position chrome that
                     * any subtree can opt into via <TabBarAccessory>.
                     * The primitive warns on duplicate mounts — this
                     * is the single canonical site.
                     */}
                    <TabBarAccessoryMount />
                    <BottomTabBar />
                </>
            ) : null}
        </div>
    );
};

export default MainLayout;
