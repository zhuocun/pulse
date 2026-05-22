import {
    BulbOutlined,
    DownOutlined,
    LogoutOutlined,
    MoonOutlined,
    SunOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Dropdown, MenuProps, Space, Switch, Typography } from "antd";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { blur, breakpoints, radius, space } from "../../theme/tokens";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAgentHealth from "../../utils/hooks/useAgentHealth";
import nativeNavigate from "../../utils/nativeNavigate";
import useAuth from "../../utils/hooks/useAuth";
import useColorScheme from "../../utils/hooks/useColorScheme";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import BrandMark from "../brandMark";
import EngineModeTag from "../engineModeTag";
import LanguageSwitcher from "../languageSwitcher";
import { NoPaddingButton } from "../projectList";
import UserAvatar from "../userAvatar";

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
    backdrop-filter: blur(${blur.md}px) saturate(180%);
    -webkit-backdrop-filter: blur(${blur.md}px) saturate(180%);
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
    position: sticky;
    top: 0;
    z-index: 10;

    /*
     * Honor the user's reduced-transparency preference: collapse the
     * glass surface to the solid page background and drop the blur.
     * Same recipe App.css uses on the body and on AntD modals/drawers.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        background-attachment: fixed;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
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

const LeftCluster = styled.div`
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    gap: ${space.xs}px;
    min-width: 0;

    @media (min-width: ${breakpoints.md}px) {
        gap: ${space.md}px;
    }
`;

const RightCluster = styled.div`
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: ${space.xxs}px;

    @media (min-width: ${breakpoints.md}px) {
        gap: ${space.xs}px;
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
    transition:
        background-color 120ms ease-out,
        color 120ms ease-out;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
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
    transition:
        background-color 120ms ease-out,
        color 120ms ease-out;
    width: 36px;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
        color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
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
    const { status } = useAgentHealth(environment.aiBaseUrl, {
        enabled: !environment.aiUseLocalEngine && environment.aiEnabled
    });
    if (status !== "degraded" && status !== "offline") return null;
    return (
        <AgentStatusDot
            $status={status}
            aria-label={
                status === "offline"
                    ? microcopy.ai.agentOffline
                    : microcopy.ai.agentDegraded
            }
            role="img"
            title={
                status === "offline"
                    ? microcopy.ai.agentOffline
                    : microcopy.ai.agentDegraded
            }
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

    && {
        height: 36px;
        padding: 0;
    }

    @media (pointer: coarse) {
        && {
            height: 44px;
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
        {
            key: "theme",
            label: (
                <SettingsRow>
                    <Space size={space.xs}>
                        {scheme === "dark" ? (
                            <MoonOutlined aria-hidden />
                        ) : (
                            <SunOutlined aria-hidden />
                        )}
                        <Typography.Text>
                            {microcopy.settings.darkMode}
                        </Typography.Text>
                    </Space>
                    <Switch
                        aria-label={microcopy.settings.toggleDarkMode}
                        checked={scheme === "dark"}
                        onChange={(checked) =>
                            setPreference(checked ? "dark" : "light")
                        }
                        size="small"
                    />
                </SettingsRow>
            )
        },
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
        <PageHeader ref={headerRef}>
            <LeftCluster>
                <BrandLink
                    aria-label={microcopy.header.logoLabel}
                    title={microcopy.header.logoLabel}
                    type="link"
                    onClick={
                        path !== "/projects"
                            ? () => nativeNavigate("/projects")
                            : undefined
                    }
                >
                    <BrandMark size="sm" />
                </BrandLink>
            </LeftCluster>
            <RightCluster>
                {environment.aiEnabled && (
                    <HiddenOnNarrow>
                        <EngineModeTag />
                    </HiddenOnNarrow>
                )}
                {environment.aiEnabled && !environment.aiUseLocalEngine && (
                    <AgentHealthBadge />
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
        </PageHeader>
    );
};

export default Header;
