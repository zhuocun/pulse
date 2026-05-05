import styled from "@emotion/styled";
import { Outlet } from "react-router";

import Header from "../components/header";
import ProjectModal from "../components/projectModal";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../theme/tokens";

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

const Main = styled.main`
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    scroll-padding-top: 64px;
`;

/**
 * Skip-to-content link. Hidden until focused, then renders a high-contrast
 * pill at the top of the viewport so keyboard users can bypass the header
 * and land on the routed page content (WCAG 2.4.1 Bypass Blocks).
 */
const SkipLink = styled.a`
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
    return (
        <Container>
            <SkipLink href="#main-content">
                {microcopy.a11y.skipToMainContent}
            </SkipLink>
            <Header />
            <Main id="main-content" tabIndex={-1}>
                <Outlet />
            </Main>
            <ProjectModal />
        </Container>
    );
};

export default MainLayout;
