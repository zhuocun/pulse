import {
    AppstoreOutlined,
    InboxOutlined,
    RobotOutlined,
    UserOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";

import { microcopy } from "../../constants/microcopy";
import {
    blur,
    brand,
    fontSize,
    fontWeight,
    motion,
    space,
    zIndex
} from "../../theme/tokens";

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
 * Keyboard hide — we listen to `visualViewport.resize` and hide the bar
 * when `window.innerHeight - visualViewport.height > 150` (a rough
 * keyboard threshold; the OS reports the keyboard via the visual
 * viewport shrink on iOS Safari and Chrome Android). A graceful
 * fallback keeps the bar visible if `visualViewport` is undefined.
 */

const KEYBOARD_HEIGHT_THRESHOLD_PX = 150;

const TAB_DEFINITIONS = [
    {
        to: "/projects",
        labelKey: "boards" as const,
        icon: <AppstoreOutlined aria-hidden />,
        /* `/projects` and any nested project route ('/projects/:id/board')
         * keep the Boards tab active so a user deep in a board still sees
         * the chassis nudge them home. */
        matchPaths: (path: string) =>
            path === "/projects" || path.startsWith("/projects/")
    },
    {
        to: "/inbox",
        labelKey: "inbox" as const,
        icon: <InboxOutlined aria-hidden />,
        matchPaths: (path: string) => path === "/inbox"
    },
    {
        to: "/copilot",
        labelKey: "copilot" as const,
        icon: <RobotOutlined aria-hidden />,
        matchPaths: (path: string) => path === "/copilot"
    },
    {
        to: "/settings",
        labelKey: "profile" as const,
        icon: <UserOutlined aria-hidden />,
        matchPaths: (path: string) => path === "/settings"
    }
];

const Nav = styled.nav<{ $hidden: boolean }>`
    align-items: stretch;
    /* Glass surface mirrors the header chrome. */
    background: var(--glass-surface);
    backdrop-filter: blur(${blur.md}px) saturate(180%);
    -webkit-backdrop-filter: blur(${blur.md}px) saturate(180%);
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
     * Drawer (1000) and Modal (1100) surfaces. The previous value
     * (1010) painted the bar on top of an open Drawer/Modal mask and
     * trapped touch users behind it. Route-level drawers now stack
     * cleanly on top via their own z-index without the bar peeking
     * through the dimmer. */
    z-index: ${zIndex.navBar};
    /* Keyboard hide: translate out of the viewport when the soft keyboard
     * pushes the visual viewport up. The translate gives us a deterministic
     * hide-vs-show contract instead of clipping the bar mid-input. */
    transform: ${(props) =>
        props.$hidden ? "translateY(100%)" : "translateY(0)"};
    transition: transform ${motion.short}ms ease-out;

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }

    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        background-attachment: fixed;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
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
    transition: color ${motion.short}ms ease-out;

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

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`;

const TabIcon = styled.span`
    /* Lift the icon to a comfortable size for thumb scanning. */
    align-items: center;
    display: inline-flex;
    font-size: 22px;
    justify-content: center;
    line-height: 1;
`;

const TabLabel = styled.span`
    line-height: ${fontSize.xs * 1.1}px;
`;

const BottomTabBar: React.FC = () => {
    const location = useLocation();
    const tabsRef = useRef<HTMLAnchorElement[]>([]);
    const [keyboardOpen, setKeyboardOpen] = useState(false);

    /*
     * Hide the bar while the soft keyboard is open. iOS Safari + Chrome
     * Android both shrink `window.visualViewport.height` when the keyboard
     * raises. When the difference exceeds the keyboard threshold (~150px),
     * we treat the keyboard as open. The fallback path leaves the bar
     * visible on UAs without `visualViewport`.
     */
    useEffect(() => {
        if (typeof window === "undefined") return;
        const vv = window.visualViewport;
        if (!vv) return;
        const handler = () => {
            const drop = window.innerHeight - vv.height;
            setKeyboardOpen(drop > KEYBOARD_HEIGHT_THRESHOLD_PX);
        };
        handler();
        vv.addEventListener("resize", handler);
        return () => vv.removeEventListener("resize", handler);
    }, []);

    /*
     * Arrow-key navigation between tabs. The `<NavLink>` elements each
     * remain in the page tab order so Tab into the bar lands on the
     * first tab; ←/→ then walks across the bar without leaving the
     * landmark. Home / End jump to the ends. Enter and Space activate
     * the link via the browser default for anchors.
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
            aria-hidden={keyboardOpen}
            aria-label={microcopy.nav.primaryLandmarkLabel}
            data-testid="bottom-tab-bar"
            onKeyDown={onKeyDown}
        >
            {TAB_DEFINITIONS.map((tab, idx) => {
                const isActive = tab.matchPaths(location.pathname);
                return (
                    <TabLink
                        key={tab.to}
                        aria-current={isActive ? "page" : undefined}
                        end={tab.to === "/projects" ? false : true}
                        ref={(node: HTMLAnchorElement | null) => {
                            tabsRef.current[idx] = node as HTMLAnchorElement;
                        }}
                        tabIndex={keyboardOpen ? -1 : 0}
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
