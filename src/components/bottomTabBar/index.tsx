import {
    AppstoreOutlined,
    InboxOutlined,
    RobotOutlined,
    UserOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { useRef } from "react";
import { NavLink, useLocation } from "react-router";

import { microcopy } from "../../constants/microcopy";
import {
    brand,
    fontSize,
    fontWeight,
    motion,
    space,
    zIndex
} from "../../theme/tokens";
import useKeyboardOpen from "../../utils/hooks/useKeyboardOpen";
import nativeNavigate from "../../utils/nativeNavigate";

/**
 * BottomTabBar — Phase 3 A3.
 *
 * Fixed-bottom navigation that activates on `pointer: coarse` viewports
 * (phones) and exposes the four primary destinations: Boards (`/projects`),
 * Inbox (`/inbox`), Copilot (`/copilot`), Profile (`/settings`).
 *
 * Markup choice — we use `<nav role="navigation" aria-label="Primary">` +
 * `<NavLink>`-per-tab rather than the ARIA `tablist`/`tab` pattern. Each
 * tab is a route, not a panel pivot inside one page, so the
 * NavLink/aria-current contract is the more accurate semantic. The
 * `<NavLink>` itself emits the active state via `aria-current="page"`,
 * which AT consumers already recognize.
 *
 * Keyboard hide — driven by `useKeyboardOpen()`, the single source of
 * truth for the keyboard-open predicate (extracted in Phase 6 Wave 1 so
 * Wave 3's Sheet primitive can share the same detection without
 * duplicating the inline listener block). The hook returns `true` when
 * `visualViewport.height < window.innerHeight * 0.75` AND a text input
 * is focused. The ratio tolerates Chrome Android's URL-bar collapse
 * (~56–100 px) without false-firing, and the activeElement gate keeps
 * us from hiding the bar when only the page scrolls. The bar stays
 * visible as a graceful fallback when `visualViewport` is undefined.
 */

/* `end={false}` on /projects keeps the Boards tab active on nested
 * routes ('/projects/:id/board'); the others require an exact match. */
const TAB_DEFINITIONS = [
    {
        to: "/projects",
        labelKey: "boards" as const,
        icon: <AppstoreOutlined aria-hidden />,
        end: false
    },
    {
        to: "/inbox",
        labelKey: "inbox" as const,
        icon: <InboxOutlined aria-hidden />,
        end: true
    },
    {
        to: "/copilot",
        labelKey: "copilot" as const,
        icon: <RobotOutlined aria-hidden />,
        end: true
    },
    {
        to: "/settings",
        labelKey: "profile" as const,
        icon: <UserOutlined aria-hidden />,
        end: true
    }
];

const Nav = styled.nav<{ $hidden: boolean }>`
    align-items: stretch;
    /* Glass surface mirrors the header chrome. */
    background: var(--glass-surface);
    /* Wave 2 T4 — consume the global intensity lever so the
     * user-facing toggle (Clear / Regular / Solid) re-tunes this bar
     * along with the rest of the chrome. Pixel-identical to the prior
     * blur(20px) saturate(180%) recipe at the default "regular"
     * intensity. */
    backdrop-filter: var(--ant-backdrop-filter-glass);
    -webkit-backdrop-filter: var(--ant-backdrop-filter-glass);
    border-top: 1px solid var(--glass-border);
    bottom: 0;
    display: flex;
    left: 0;
    padding-block-start: ${space.xs}px;
    /* iOS home-indicator clearance — the bar floats above the system gesture
     * area without the safe-area inset shrinking the tab tap targets. */
    padding-block-end: env(safe-area-inset-bottom);
    padding-inline-start: env(safe-area-inset-left);
    padding-inline-end: env(safe-area-inset-right);
    position: fixed;
    right: 0;
    /* Sit in the navBar tier — above page content but below AntD's
     * Drawer + Modal mask (both paint at z-index 1000) and Modal
     * content (1010). The previous bar value (1010) painted on top
     * of an open Drawer/Modal mask and trapped touch users behind
     * it. Route-level drawers now stack cleanly on top via their
     * own z-index without the bar peeking through the dimmer. */
    z-index: ${zIndex.navBar};
    /* Opt the bar out of the route cross-fade (matches the header's
       pulse-header treatment); keeps it pinned across navigations
       instead of flickering with the body swap. */
    view-transition-name: pulse-tabbar;
    /* Keyboard hide: translate out of the viewport when the soft keyboard
     * pushes the visual viewport up. The translate gives us a deterministic
     * hide-vs-show contract instead of clipping the bar mid-input. */
    transform: ${(props) =>
        props.$hidden ? "translateY(100%)" : "translateY(0)"};
    transition: transform ${motion.short}ms ease-out;

    /*
     * Phase 5 "Liquid Glass" Wave 2 — top-leading specular rim. The
     * 135deg axis catches the highlight on the bar's upper edge,
     * which is the edge the user sees against scrolling content
     * directly above the bar. No scroll-edge dissolve here — the bar
     * is pinned to the viewport bottom rather than sitting over
     * content scrolled past it.
     */
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--glass-specular-top);
        pointer-events: none;
        z-index: 0;
    }

    /*
     * Companion bottom-trailing shadow trough. Same recipe the header
     * uses, sans the mask-image edge dissolve.
     */
    &::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--glass-specular-bottom);
        pointer-events: none;
        z-index: 0;
    }

    /* Children sit above the rim pseudo-elements. */
    > * {
        position: relative;
        z-index: 1;
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }

    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        background-attachment: fixed;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;

        &::before,
        &::after {
            background: none;
        }
    }

    @media (forced-colors: active) {
        &::before,
        &::after {
            background: none;
        }
    }
`;

const TabLink = styled(NavLink)`
    align-items: center;
    background: transparent;
    border: none;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    cursor: pointer;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    font-size: ${fontSize.xs}px;
    gap: 2px;
    justify-content: center;
    min-height: 56px;
    min-width: 25vw;
    padding: ${space.xxs}px ${space.xs}px;
    position: relative;
    text-decoration: none;
    /*
     * Phase 5 "Liquid Glass" Wave 2 — gel-flex on bottom-tab taps.
     * Each NavLink yields on press for tactile parity with the
     * header's IconButton / PillTrigger. transform-only; layout box
     * stays 56 px tall so the min-height invariant is preserved.
     */
    transition:
        color ${motion.short}ms ease-out,
        transform var(--motion-gel-flex, 220ms)
            var(--easing-spring-snap, ease-out);
    will-change: transform;

    /* The active-state indicator is a hairline top stripe + colored
     * label + heavier weight. NavLink emits aria-current=page on the
     * active link automatically; we re-use that attribute as our style
     * selector so the markup contract and the visual contract stay in
     * sync. */
    &[aria-current="page"] {
        color: ${brand.primary};
        font-weight: ${fontWeight.semibold};
    }

    &[aria-current="page"]::before {
        background: ${brand.primary};
        border-radius: 999px;
        content: "";
        height: 2px;
        left: 12%;
        position: absolute;
        right: 12%;
        top: 0;
    }

    &:hover {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
    }

    &:focus-visible {
        outline: 2px solid ${brand.primary};
        outline-offset: -2px;
    }

    &:active {
        transform: scale(0.97);
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;

        &:active {
            transform: none;
        }
    }
`;

const TabIcon = styled.span`
    /* Lift the icon to a comfortable size for thumb scanning. */
    align-items: center;
    display: inline-flex;
    font-size: ${fontSize.xl}px;
    justify-content: center;
    line-height: 1;
`;

const TabLabel = styled.span`
    line-height: ${fontSize.xs * 1.1}px;
`;

/*
 * Same iOS Safari WebKit / Chrome Android "URL changed, page didn't
 * navigate" purgatory that bites `ProjectCard.TitleLink` and the brand
 * logo (see `nativeNavigate.ts`). React Router's context propagation
 * fails on those engines when the click originates from a subtree
 * loaded under deep providers (board page, with the DnD context + AI
 * drawers + multiple `useUrl` instances mounted). The address bar
 * updates via `pushState` but `Routes` never re-renders — refreshing
 * the page resolves it because the React tree mounts fresh against
 * the new URL. We mirror the project-card pattern: keep the anchor
 * `href` for accessibility + middle-/modifier-click, but intercept the
 * primary click and force a real document navigation.
 */
const isPrimaryClick = (event: React.MouseEvent<HTMLAnchorElement>): boolean =>
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.button === 0;

const BottomTabBar: React.FC = () => {
    const tabsRef = useRef<HTMLAnchorElement[]>([]);
    const location = useLocation();
    /*
     * Hide the bar while the soft keyboard is open. The detection
     * predicate (visualViewport ratio + input-focused gate, with
     * graceful fallback when the API is missing) lives in
     * `useKeyboardOpen` so Wave 3's Sheet primitive can share the
     * same source of truth without duplicating the listener block.
     */
    const keyboardOpen = useKeyboardOpen();

    /*
     * Arrow-key navigation as a convenience. We use a <nav> landmark
     * with NavLinks (not the ARIA tablist roving-tabindex pattern); each
     * tab is independently Tab-reachable so screen-reader users walk
     * them as plain links. ←/→ and Home/End move focus across the bar
     * once the user has tabbed in. Enter and Space activate via the
     * browser anchor default.
     */
    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        const tabs = tabsRef.current.filter((node): node is HTMLAnchorElement =>
            Boolean(node)
        );
        if (tabs.length === 0) return;
        const current = tabs.findIndex(
            (node) => node === document.activeElement
        );
        if (current < 0) return;
        let next: number;
        if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
        else if (event.key === "ArrowLeft")
            next = (current - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[next]?.focus();
    };

    return (
        <Nav
            $hidden={keyboardOpen}
            // `inert` removes the subtree from the a11y tree AND blocks
            // pointer/focus in one declarative attribute — replaces the
            // legacy aria-hidden+tabIndex=-1 hand-rolled pattern.
            inert={keyboardOpen || undefined}
            aria-label={microcopy.nav.primaryLandmarkLabel}
            data-glass-context="true"
            data-testid="bottom-tab-bar"
            onKeyDown={onKeyDown}
        >
            {TAB_DEFINITIONS.map((tab, idx) => {
                // Same active-state predicate NavLink applies internally:
                // exact match, or any prefix match when `end={false}`.
                const isActive = tab.end
                    ? location.pathname === tab.to
                    : location.pathname === tab.to ||
                      location.pathname.startsWith(`${tab.to}/`);
                return (
                    <TabLink
                        key={tab.to}
                        end={tab.end}
                        onClick={(event) => {
                            // Leave the active tab a no-op; let
                            // modifier-clicks open in a new tab via the
                            // anchor `href`.
                            if (isActive || !isPrimaryClick(event)) return;
                            event.preventDefault();
                            nativeNavigate(tab.to);
                        }}
                        ref={(node: HTMLAnchorElement | null) => {
                            tabsRef.current[idx] = node as HTMLAnchorElement;
                        }}
                        to={tab.to}
                    >
                        <TabIcon>{tab.icon}</TabIcon>
                        <TabLabel>{microcopy.nav.tabs[tab.labelKey]}</TabLabel>
                    </TabLink>
                );
            })}
        </Nav>
    );
};

export default BottomTabBar;
