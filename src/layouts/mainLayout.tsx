import styled from "@emotion/styled";
import { Suspense } from "react";
import { Outlet } from "react-router";

import BottomTabBar from "../components/bottomTabBar";
import Header from "../components/header";
import ProjectModal from "../components/projectModal";
import { PageSpin } from "../components/status";
import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../theme/tokens";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";

/*
 * Reads page-level theme tokens defined in App.css. AntD's own `--ant-*`
 * vars are scoped to its component class so `body`/`html` never see them
 * — the page chrome would stay in its light-mode fallback when the user
 * toggled dark mode.
 *
 * `grid-template-columns: minmax(0, 1fr)` is required: a grid track
 * defaults to `auto` minimums and will grow to fit its widest descendant.
 * The board's kanban (which scrolls horizontally inside its own
 * container) was therefore stretching the grid track past the viewport,
 * which clipped the header's right edge under `body { overflow-x: hidden }`
 * and pushed action buttons (Brief / Ask / Add column) off-screen.
 */
const Container = styled.div`
    /* Transparent so the aurora mesh painted on body shows through.
     * The --pulse-bg-page variable still backs the body fallback under
     * prefers-reduced-transparency (see App.css). */
    background: transparent;
    color: var(--pulse-text-base);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    min-height: 100vh;
    min-height: 100dvh;
`;

const Main = styled.main<{ $hasBottomNav: boolean }>`
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    scroll-padding-top: 64px;
    /*
     * When the bottom tab bar mounts (phone + flag on), reserve space so
     * the fixed-position bar doesn't occlude the routed content. The
     * 64 px figure matches the bar's 56 px touch target + 8 px top
     * padding; safe-area-inset-bottom is added on top so iOS home
     * indicator devices clear the gesture area. The bar itself owns the
     * safe-area inset in its own padding-block-end so the icons stay
     * within the visible band; this offset on the main region is the
     * scroll-content clearance.
     */
    padding-bottom: ${(props) =>
        props.$hasBottomNav ? "calc(64px + env(safe-area-inset-bottom))" : "0"};
`;

/**
 * Skip-to-content link. Hidden until focused, then renders a high-contrast
 * pill at the top of the viewport so keyboard users can bypass the header
 * and land on the routed page content (WCAG 2.4.1 Bypass Blocks).
 */
const SkipLink = styled.a`
    /*
     * Unfocused skip links sit above sticky chrome (z-index) while translated
     * off-screen; keep pointer-events off until focus so clicks reach real targets.
     */
    pointer-events: none;
    background: var(--ant-color-primary, #ea580c);
    border-radius: ${radius.md}px;
    color: #fff;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    left: ${space.sm}px;
    padding: ${space.xs}px ${space.md}px;
    position: absolute;
    text-decoration: none;
    top: ${space.sm}px;
    transform: translateY(-200%);
    transition: transform 120ms ease-out;
    z-index: 9999;

    &:focus,
    &:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
        pointer-events: auto;
        transform: translateY(0);
    }
`;

/**
 * Application shell. Header + outlet + always-mounted ProjectModal drawer.
 *
 * The previous version hard-coded `min-width: 1024px`, `max-height: 1440px`,
 * and `overflow: scroll` on `<main>`, which blocked mobile/tablet entirely
 * and produced double scrollbars (the inner column container scrolls too).
 * We now let the inner regions own scroll and let the page reflow at any
 * width down to 320px (WCAG 1.4.10).
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
        <Container>
            <SkipLink href="#main-content">
                {microcopy.a11y.skipToMainContent}
            </SkipLink>
            <Header />
            <Main $hasBottomNav={showBottomNav} id="main-content" tabIndex={-1}>
                {/* Suspense lives inside the layout so the header + bottom
                 * tab bar stay mounted while a lazy page chunk fetches. */}
                <Suspense fallback={<PageSpin />}>
                    <Outlet />
                </Suspense>
            </Main>
            <ProjectModal />
            {showBottomNav ? <BottomTabBar /> : null}
        </Container>
    );
};

export default MainLayout;
