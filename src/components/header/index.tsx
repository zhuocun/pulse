import {
    BulbOutlined,
    DownOutlined,
    LogoutOutlined,
    MoonOutlined,
    SunOutlined
} from "@ant-design/icons";
import { keyframes } from "@emotion/react";
import styled from "@emotion/styled";
import { Dropdown, MenuProps, Space, Switch, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    easing,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    motion,
    radius,
    space
} from "../../theme/tokens";
import { formatAgentHealthMessage } from "../../utils/ai/agentHealthCopy";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAgentHealth from "../../utils/hooks/useAgentHealth";
import useAuth from "../../utils/hooks/useAuth";
import useColorScheme from "../../utils/hooks/useColorScheme";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import ActivityFeedDrawer, { ActivityFeedBell } from "../activityFeedDrawer";
import BrandMark from "../brandMark";
import EngineModeTag from "../engineModeTag";
import GlassIntensitySelect from "../glassIntensitySelect";
import LanguageSwitcher from "../languageSwitcher";
import { NoPaddingButton } from "../projectList";
import UserAvatar from "../userAvatar";

/**
 * Resolves the current top-level route to the contextual title shown in the
 * centered phone-chrome navigation bar. Board / project-detail routes return
 * `null` because they render their own breadcrumb sub-header — surfacing a
 * title here too would duplicate it.
 */
export const resolveMobileHeaderTitle = (path: string): string | null => {
    if (path === "/projects") return microcopy.nav.tabs.boards;
    if (path.startsWith("/projects/")) return null;
    if (path.startsWith("/inbox")) return microcopy.nav.tabs.inbox;
    if (path.startsWith("/copilot")) return microcopy.nav.tabs.copilot;
    if (path.startsWith("/settings")) return microcopy.settings.pageTitle;
    return null;
};

const PageHeader = styled.header`
    /* Icons centred vertically inside the chrome (align-items: center)
     * with symmetric block padding on both edges. Block padding steps
     * up at md and lg so the bar reads as a calmer, taller chrome on
     * laptop / desktop while staying compact on phone — the icons
     * always sit in the optical centre of the band rather than hugging
     * the bottom edge.
     *
     * The earlier flex-end + zero padding-bottom pattern made sense
     * when the header was a tight ~46 px row across every viewport,
     * but with the responsive height bump the icons started looking
     * stranded against the bottom of a tall band on desktop. */
    align-items: center;
    /*
     * Frosted-glass chrome. The translucent surface lets the page
     * gradient (and any content scrolled under the header) read
     * through, while backdrop-filter blur de-noises that content so the
     * icons stay legible. We use the lightest --glass-surface-subtle
     * (~50 % opaque) so the chrome reads as clearly transparent —
     * the brand-orange aurora glow at the top of the page and any
     * scrolled content are meant to be felt through the bar, not
     * masked by it. The blur compensates by smearing whatever shows
     * through into a frosted texture rather than legible content.
     * The 1 px hairline border-bottom gives the chrome a faint edge
     * so the bottom of the band still reads as a chrome boundary at
     * rest, when there is nothing scrolled under it yet.
     */
    background: var(--glass-surface-subtle);
    /* Wave 2 T4 — read the global intensity lever instead of the
     * literal blur recipe so the user-facing toggle (Clear / Regular /
     * Solid) flips this chrome along with every other glass surface.
     * Default value at "regular" intensity is the previous
     * blur(20px) saturate(180%) recipe — pixel-identical to the
     * pre-migration shipping value. */
    backdrop-filter: var(--ant-backdrop-filter-glass);
    -webkit-backdrop-filter: var(--ant-backdrop-filter-glass);
    border-bottom: 1px solid var(--glass-border);
    /*
     * Opt the sticky header out of the route cross-fade. With its own
     * view-transition-name the browser keeps it in place while the body
     * cross-fades, which is what makes the page change feel like a native
     * push transition rather than a full-page swap.
     */
    view-transition-name: pulse-header;
    display: flex;
    justify-content: space-between;
    gap: ${space.xs}px;
    padding: 2px ${space.sm}px;
    padding-block-start: max(2px, env(safe-area-inset-top));
    padding-inline-start: max(${space.sm}px, env(safe-area-inset-left));
    padding-inline-end: max(${space.sm}px, env(safe-area-inset-right));
    /*
     * Phase 5 "Liquid Glass" Wave 2 — position the chrome as a
     * relative containing block so the ::before / ::after specular
     * rim layers and the scroll-edge dissolve gradient anchor to the
     * header's box. position:sticky already creates a stacking context,
     * but the rim recipe below depends on this containment regardless.
     */
    position: sticky;
    top: 0;
    z-index: 10;

    /*
     * Phase 5 "Liquid Glass" Wave 2 — top-leading specular rim. A
     * tilted achromatic highlight that models a light source at the
     * top-leading corner catching the glass edge. The 135deg axis is
     * fixed (light-source-conventional per Apple HIG); the gradient
     * fades by 40% so the highlight pins to the rim rather than
     * washing the centre of the chrome.
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
     * Phase 5 "Liquid Glass" Wave 2 — bottom-trailing companion
     * shadow. ::after paints the soft trough on the opposite corner
     * from the highlight. The scroll-edge dissolve is on the chrome
     * element itself (below) — masking ::after would only fade the
     * rim shadow, not the actual chrome surface that needs to taper
     * for the "content dissolves under chrome" effect.
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

    /*
     * Scroll-edge dissolve: mask the bottom 12 px of the chrome
     * surface itself (including its backdrop-filter blur and tinted
     * background) so scrolling content fades up through the chrome
     * edge instead of hitting a hard cut. The 12 px is added as
     * padding-bottom so the LeftCluster / RightCluster children sit
     * above the masked region and don't get clipped — the bottom
     * 12 px is intentional dead-zone trim that only the chrome
     * paints into. forced-colors + reduced-transparency drop the
     * mask below.
     */
    padding-bottom: 12px;
    mask-image: linear-gradient(
        to bottom,
        black calc(100% - 12px),
        transparent 100%
    );
    -webkit-mask-image: linear-gradient(
        to bottom,
        black calc(100% - 12px),
        transparent 100%
    );

    /*
     * Children sit above the rim pseudo-elements. The two flex
     * clusters (LeftCluster, RightCluster) are direct children — lift
     * them so the rim layers paint *behind* the icons / brand link
     * rather than over them.
     */
    > * {
        position: relative;
        z-index: 1;
    }

    /*
     * Honor the user's reduced-transparency preference: collapse the
     * glass surface to the solid page background and drop the blur.
     * Same recipe App.css uses on the body and on AntD modals/drawers.
     * Drop the rim + dissolve too — the achromatic highlight reads as
     * noise once the body becomes opaque.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        background-attachment: fixed;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        padding-bottom: 0;
        mask-image: none;
        -webkit-mask-image: none;

        &::before,
        &::after {
            background: none;
        }
    }

    /*
     * Forced-colors mode (Windows high-contrast) replaces every author
     * colour with system tokens. Drop the rim layers so Canvas /
     * CanvasText win without competing achromatic gradients painted
     * on top.
     */
    @media (forced-colors: active) {
        padding-bottom: 0;
        mask-image: none;
        -webkit-mask-image: none;

        &::before,
        &::after {
            background: none;
        }
    }

    @media (min-width: ${breakpoints.sm}px) {
        padding-inline: ${space.md}px;
        padding-inline-start: max(${space.md}px, env(safe-area-inset-left));
        padding-inline-end: max(${space.md}px, env(safe-area-inset-right));
    }

    /*
     * Laptop / desktop viewports get a taller chrome — the page no
     * longer competes with the OS status bar for vertical pixels, and
     * a denser bar feels under-set against a wide aurora wash. Bump
     * symmetric block padding to space.xs (8 px) at md+, then space.sm
     * (12 px) at lg+ so the band reads as ~52 px on tablet/laptop and
     * ~60 px on full desktop with the icons (36 px row) centred
     * vertically.
     */
    @media (min-width: ${breakpoints.md}px) {
        padding-block: ${space.xs}px;
        padding-inline: ${space.lg}px;
        padding-inline-start: max(${space.lg}px, env(safe-area-inset-left));
        padding-inline-end: max(${space.lg}px, env(safe-area-inset-right));
    }

    @media (min-width: ${breakpoints.lg}px) {
        padding-block: ${space.sm}px;
    }
`;

const LeftCluster = styled.div<{ $centered?: boolean }>`
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    gap: ${space.xs}px;
    min-width: 0;

    @media (min-width: ${breakpoints.md}px) {
        gap: ${space.md}px;
    }

    ${(props) => (props.$centered ? "flex: 1 1 0;" : "")}
`;

const RightCluster = styled.div<{ $centered?: boolean }>`
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: ${space.xxs}px;

    @media (min-width: ${breakpoints.md}px) {
        gap: ${space.xs}px;
    }

    ${(props) =>
        props.$centered ? "flex: 1 1 0; justify-content: flex-end;" : ""}
`;

const titleEnter = keyframes`
    from {
        opacity: 0;
        transform: translateY(4px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
`;

/**
 * Centered contextual title third (phone chrome only). Sits between the two
 * flex clusters; with all three children at `flex: 1 1 0` the middle third is
 * truly centered in the bar regardless of differing left/right widths.
 * Non-interactive — `pointer-events: none` so taps fall through to whatever
 * sits behind it.
 */
const CenterTitle = styled.div`
    align-items: center;
    display: flex;
    flex: 1 1 0;
    justify-content: center;
    min-width: 0;
    pointer-events: none;
`;

const CenterTitleText = styled.span`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.semibold};
    line-height: ${lineHeight.tight};
    letter-spacing: ${letterSpacing.tight};
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    animation: ${titleEnter} ${motion.medium}ms ${easing.standard};

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

/**
 * Soft pill-shaped trigger used for the account dropdown and the inline
 * theme toggle. Stays at 36 px on desktop / 44 px on coarse pointers so
 * touch users get an honest WCAG 2.5.8 target.
 *
 * The trigger limits itself to half of the available right-cluster width on
 * narrow viewports so a long username does not push the chevron / icon
 * buttons off-screen. The username text inside truncates with ellipsis.
 */
const PillTrigger = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radius.pill}px;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    flex: 0 1 auto;
    font: inherit;
    gap: ${space.xs}px;
    height: 36px;
    max-width: 100%;
    min-width: 0;
    padding: 0 ${space.xs}px;
    /*
     * Phase 5 "Liquid Glass" Wave 2 — gel-flex micro-animation. The
     * pill yields ~3 % under press then springs back via the snap
     * easing curve. transform-only so the hit area (computed from
     * layout, not paint) is unaffected and WCAG 2.5.5 stays intact
     * on coarse pointers. will-change keeps the GPU layer hot.
     */
    transition:
        background-color 120ms ease-out,
        color 120ms ease-out,
        transform var(--motion-gel-flex, 220ms)
            var(--easing-spring-snap, ease-out);
    will-change: transform;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
    }

    &:active {
        transform: scale(0.97);
    }

    @media (prefers-reduced-motion: reduce) {
        transition:
            background-color 120ms ease-out,
            color 120ms ease-out;

        &:active {
            transform: none;
        }
    }

    @media (min-width: ${breakpoints.sm}px) {
        padding: 0 ${space.sm}px;
    }

    @media (pointer: coarse) {
        height: 44px;
    }
`;

/**
 * Truncated username inside the account pill. `min-width: 0` lets it shrink
 * inside the flex parent, and `max-width` keeps it from monopolising the
 * row when the user has a long name (e.g. `Constance van der Linden`).
 */
const Greeting = styled(Typography.Text)`
    && {
        font-weight: 500;
        max-width: 14ch;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`;

/**
 * Square icon button (used for the inline theme toggle and other tertiary
 * controls). Keeps a single visual rhythm with the pill trigger.
 */
const IconButton = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radius.md}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    cursor: pointer;
    display: inline-flex;
    height: 36px;
    justify-content: center;
    padding: 0;
    /*
     * Phase 5 "Liquid Glass" Wave 2 — gel-flex press recovery, same
     * recipe as PillTrigger. Layout box stays intact under transform
     * so the 44 × 44 coarse-pointer hit area is preserved.
     */
    transition:
        background-color 120ms ease-out,
        color 120ms ease-out,
        transform var(--motion-gel-flex, 220ms)
            var(--easing-spring-snap, ease-out);
    width: 36px;
    will-change: transform;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
        color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
    }

    &:active {
        transform: scale(0.97);
    }

    @media (prefers-reduced-motion: reduce) {
        transition:
            background-color 120ms ease-out,
            color 120ms ease-out;

        &:active {
            transform: none;
        }
    }

    @media (pointer: coarse) {
        height: 44px;
        width: 44px;
    }
`;

const HiddenOnNarrow = styled.span`
    @media (max-width: ${breakpoints.md - 1}px) {
        display: none;
    }
`;

const HiddenOnTiny = styled.span`
    @media (max-width: ${breakpoints.sm - 1}px) {
        display: none;
    }
`;

/**
 * Phone-demotion wrapper (Phase 3 A3). When the bottom-tab chassis
 * is enabled, the right-cluster account / settings dropdown collapses
 * to nothing on coarse-pointer viewports — those controls now live on
 * the routed Settings page reachable from the bottom-tab Profile
 * entry. Desktop / mouse users keep the dropdown untouched.
 *
 * The visibility branch is driven by the shared `useIsPhoneChrome`
 * hook so the demote-gate and the BottomTabBar mount-gate consume the
 * same predicate (`pointer: coarse`). The previous implementation
 * emitted the hide via `@media (pointer: coarse)` CSS, which diverged
 * from MainLayout's `Grid.useBreakpoint().md === false` mount-gate —
 * touchscreen laptops were hiding controls while never mounting the
 * bar, leaving the user with no way to reach logout / theme.
 *
 * We still wrap the controls in a `<span>` so the JSX shape stays
 * stable for tests that traverse the DOM (the wrapper exists either
 * way; we just toggle `display` from JS instead of CSS).
 */
const HiddenWhenDemoted = styled.span<{ $hidden: boolean }>`
    ${(props) => (props.$hidden ? "display: none;" : "")}
`;

/**
 * Small status dot that appears only when the AI backend is `degraded` or
 * `offline`. Hidden when the local engine is active or AI is disabled — no
 * point polling a server the FE doesn't use.
 */
const AgentStatusDot = styled.span<{ $status: "degraded" | "offline" }>`
    border-radius: 50%;
    display: inline-block;
    height: 8px;
    width: 8px;
    flex: 0 0 auto;
    background: ${(props) =>
        props.$status === "offline"
            ? "var(--ant-color-error, #EF4444)"
            : "var(--ant-color-warning, #F59E0B)"};
`;

/**
 * Inner component that calls useAgentHealth so we can gate the hook behind a
 * conditional render — hooks must not be called conditionally at the top
 * level. Rendered only when aiEnabled is true and aiUseLocalEngine is false.
 */
const AgentHealthBadge: React.FC = () => {
    const health = useAgentHealth(environment.aiBaseUrl, {
        enabled: !environment.aiUseLocalEngine && environment.aiEnabled
    });
    const { status } = health;
    if (health.lastChecked === null) return null;
    if (status !== "degraded" && status !== "offline") return null;
    const label = formatAgentHealthMessage(health);
    return (
        <AgentStatusDot
            $status={status}
            aria-label={label}
            role="img"
            title={label}
        />
    );
};

/**
 * Brand cluster — the shared `BrandMark` component (so a future brand
 * refresh is a single edit) wrapped in a `NoPaddingButton` so it stays
 * keyboard-focusable and announces "Pulse, link" to assistive tech.
 */
const BrandLink = styled(NoPaddingButton)`
    align-items: center;
    display: inline-flex;
    flex: 0 1 auto;
    min-width: 0;
    /*
     * Phase 5 "Liquid Glass" Wave 2 — gel-flex on the brand pill.
     * Yields under press for the same tactile feedback the IconButton
     * + PillTrigger get. The shorthand REPLACES AntD's own
     * transition:all so we re-enumerate the colour / bg / border /
     * box-shadow channels AntD animates (using AntD's own 100 ms
     * cadence) and stack the spring-timed transform on top. Without
     * the enumeration, AntD's hover bg / colour changes go instant.
     */
    transition:
        color 100ms ease-in-out,
        background 100ms ease-in-out,
        border-color 100ms ease-in-out,
        box-shadow 100ms ease-in-out,
        transform var(--motion-gel-flex, 220ms)
            var(--easing-spring-snap, ease-out);
    will-change: transform;

    && {
        height: 36px;
        padding: 0;
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

    @media (pointer: coarse) {
        && {
            height: 44px;
            justify-content: center;
            min-width: 44px;
        }
    }

    /* On the narrowest viewports there isn't room for the wordmark beside
     * the projects popover; the brand collapses to its glyph. */
    @media (max-width: ${breakpoints.sm - 1}px) {
        > span > span:last-child {
            display: none;
        }
    }
`;

const SettingsRow = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.sm}px;
    justify-content: space-between;
    padding: ${space.xxs}px ${space.xs}px;
    min-width: 240px;
`;

const Header: React.FC = () => {
    const { user, logout } = useAuth();
    const {
        available: aiAvailable,
        enabled: aiEnabled,
        setEnabled: setAiEnabled
    } = useAiEnabled();
    const { scheme, setPreference } = useColorScheme();
    const path = useLocation().pathname;
    const navigate = useNavigate();
    /*
     * Phase 4.3 — activity feed. The bell icon is always visible
     * (including phone chrome) so notifications stay reachable without
     * touching the demoted dropdown. The flag is a hard kill-switch so
     * deployed builds can roll back the entire surface with one env
     * var; see `environment.activityFeedEnabled` for the rationale.
     */
    const { unreadCount } = useActivityFeed();
    const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
    /*
     * Phase 3 A3 — phone demotion. The flag-gated `bottomNavEnabled`
     * env switch composes with the shared `useIsPhoneChrome` predicate
     * so the right-cluster only hides when (a) the bottom-tab chassis
     * is rolled out AND (b) the user is on a coarse-pointer surface
     * where the bar actually mounts. See `useIsPhoneChrome` and the
     * matching gate in `MainLayout` for the predicate alignment.
     */
    const isPhoneChrome = useIsPhoneChrome();
    const rightClusterHidden = environment.bottomNavEnabled && isPhoneChrome;
    /*
     * iOS-26-style centered contextual title — phone chrome only. Suppressed
     * on board / project-detail routes (they own their breadcrumb sub-header)
     * and on desktop. When present, the title shifts the clusters to equal
     * flex thirds so it centers truly between them.
     */
    const mobileTitle = isPhoneChrome ? resolveMobileHeaderTitle(path) : null;
    const titleCentered = mobileTitle !== null;
    /*
     * Publish the rendered header height to a global CSS custom property
     * so secondary sticky chrome (e.g. the project detail page's
     * breadcrumb / tabs row) can stick at `top: var(--header-height)`
     * without hard-coding the offset. ResizeObserver covers safe-area
     * changes, breakpoint-driven padding shifts, and zoom — anything
     * that nudges the header height keeps the offset accurate.
     */
    const headerRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const node = headerRef.current;
        if (!node || typeof ResizeObserver === "undefined") return;
        const writeHeight = (h: number) => {
            document.documentElement.style.setProperty(
                "--header-height",
                `${h}px`
            );
        };
        writeHeight(node.getBoundingClientRect().height);
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                writeHeight(entry.contentRect.height);
            }
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const items: MenuProps["items"] = [
        ...(aiAvailable
            ? [
                  {
                      key: "ai",
                      label: (
                          <SettingsRow>
                              <Space size={space.xs}>
                                  <BulbOutlined aria-hidden />
                                  <Typography.Text>
                                      {microcopy.settings.boardCopilot}
                                  </Typography.Text>
                              </Space>
                              <Switch
                                  aria-label={
                                      microcopy.settings.toggleBoardCopilot
                                  }
                                  checked={aiEnabled}
                                  onChange={setAiEnabled}
                                  size="small"
                              />
                          </SettingsRow>
                      )
                  }
              ]
            : []),
        {
            key: "language",
            label: <LanguageSwitcher />
        },
        /*
         * Phase 5 Wave 2 T4 — user-facing glass-intensity toggle.
         * Renders the four-option Segmented picker inline inside the
         * dropdown, mirroring the LanguageSwitcher row above. The
         * setting persists through the userPreferences slice's
         * persistence middleware on every dispatch, so the choice
         * round-trips through localStorage without further
         * orchestration.
         */
        {
            key: "glass-intensity",
            label: <GlassIntensitySelect />
        },
        { type: "divider" as const },
        {
            key: "logout",
            label: (
                <NoPaddingButton
                    aria-label={microcopy.actions.logOut}
                    icon={<LogoutOutlined />}
                    onClick={() => {
                        logout();
                    }}
                    type="link"
                >
                    {microcopy.actions.logOut}
                </NoPaddingButton>
            )
        }
    ];

    return (
        <PageHeader data-glass-context="true" ref={headerRef}>
            <LeftCluster $centered={titleCentered}>
                <BrandLink
                    aria-label={microcopy.header.logoLabel}
                    title={microcopy.header.logoLabel}
                    type="link"
                    onClick={
                        path !== "/projects"
                            ? () =>
                                  navigate("/projects", {
                                      viewTransition: true
                                  })
                            : undefined
                    }
                >
                    <BrandMark size="sm" />
                </BrandLink>
            </LeftCluster>
            {mobileTitle !== null && (
                <CenterTitle>
                    <CenterTitleText key={mobileTitle}>
                        {mobileTitle}
                    </CenterTitleText>
                </CenterTitle>
            )}
            <RightCluster $centered={titleCentered}>
                {environment.aiEnabled && (
                    <HiddenOnNarrow>
                        <EngineModeTag />
                    </HiddenOnNarrow>
                )}
                {environment.aiEnabled && !environment.aiUseLocalEngine && (
                    <AgentHealthBadge />
                )}
                {/*
                 * Phase 4.3 — activity feed bell. The bell renders on
                 * every viewport (including phone chrome) so the user
                 * can reach the drawer from anywhere. The drawer itself
                 * lives below the header chrome so its bottom-sheet
                 * placement on phones works without colliding with the
                 * bottom-tab bar.
                 */}
                {environment.activityFeedEnabled && (
                    <ActivityFeedBell
                        unreadCount={unreadCount}
                        onClick={() => setActivityDrawerOpen((prev) => !prev)}
                    />
                )}
                {/*
                 * Phone-demotion wrapper. With the bottom-tab chassis
                 * active (Phase 3 A3, flag default ON), theme + account
                 * controls move to the routed Settings page reachable
                 * from the Profile tab. The right-cluster collapses to
                 * just the EngineModeTag + AgentHealthBadge on phones.
                 * Desktop / coarse-disabled builds keep the controls
                 * inline as before — the flag falls back to the legacy
                 * chrome with one env var.
                 */}
                <HiddenWhenDemoted $hidden={rightClusterHidden}>
                    <IconButton
                        aria-label={
                            scheme === "dark"
                                ? microcopy.a11y.useLightMode
                                : microcopy.a11y.useDarkMode
                        }
                        onClick={() =>
                            setPreference(scheme === "dark" ? "light" : "dark")
                        }
                        type="button"
                    >
                        {scheme === "dark" ? (
                            <SunOutlined aria-hidden />
                        ) : (
                            <MoonOutlined aria-hidden />
                        )}
                    </IconButton>
                </HiddenWhenDemoted>
                <HiddenWhenDemoted $hidden={rightClusterHidden}>
                    <Dropdown menu={{ items }} trigger={["click"]}>
                        <PillTrigger
                            aria-label={microcopy.a11y.accountMenuFor.replace(
                                "{name}",
                                user?.username ?? ""
                            )}
                            onClick={(event) => event.preventDefault()}
                            type="button"
                        >
                            <UserAvatar
                                id={user?._id ?? user?.username ?? "anon"}
                                name={user?.username}
                                size="small"
                            />
                            <HiddenOnTiny>
                                <Greeting>
                                    {microcopy.greeting.replace(
                                        "{name}",
                                        user?.username ?? ""
                                    )}
                                </Greeting>
                            </HiddenOnTiny>
                            <HiddenOnNarrow>
                                <DownOutlined
                                    aria-hidden
                                    style={{
                                        color: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45))",
                                        fontSize: 10
                                    }}
                                />
                            </HiddenOnNarrow>
                        </PillTrigger>
                    </Dropdown>
                </HiddenWhenDemoted>
            </RightCluster>
            {environment.activityFeedEnabled && (
                <ActivityFeedDrawer
                    open={activityDrawerOpen}
                    onClose={() => setActivityDrawerOpen(false)}
                />
            )}
        </PageHeader>
    );
};

export default Header;
