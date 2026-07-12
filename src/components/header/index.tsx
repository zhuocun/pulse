import {
    Bot,
    ChevronDown,
    Inbox,
    LayoutGrid,
    Lightbulb,
    LogOut,
    Moon,
    Sun
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { formatAgentHealthMessage } from "../../utils/ai/agentHealthCopy";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAgentHealth from "../../utils/hooks/useAgentHealth";
import useAuth from "../../utils/hooks/useAuth";
import useColorScheme from "../../utils/hooks/useColorScheme";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useNotifications from "../../utils/hooks/useNotifications";
import ActivityFeedDrawer, { ActivityFeedBell } from "../activityFeedDrawer";
import NotificationDrawer, { NotificationBell } from "../notificationBell";
import BrandMark from "../brandMark";
import EngineModeTag from "../engineModeTag";
import GlassIntensitySelect from "../glassIntensitySelect";
import LanguageSwitcher from "../languageSwitcher";
import UserAvatar from "../userAvatar";

/**
 * Resolves the current top-level route to the contextual title shown in the
 * centered phone-chrome navigation bar. Board / project-detail routes return
 * `null` because they render their own breadcrumb sub-header — surfacing a
 * title here too would duplicate it.
 */
export const resolveMobileHeaderTitle = (path: string): string | null => {
    /*
     * Top-level tab destinations (/projects, /inbox, /copilot, /settings)
     * each render their own page H1. Surfacing a second title in the
     * sticky header duplicates ~80 px of chrome on every phone route.
     * Project-detail routes keep null here — their breadcrumb sub-header
     * carries the project name.
     */
    if (path.startsWith("/projects/")) return null;
    if (
        path === "/projects" ||
        path.startsWith("/inbox") ||
        path.startsWith("/copilot") ||
        path.startsWith("/settings")
    ) {
        return null;
    }
    return null;
};

/*
 * Frosted-glass sticky chrome. The translucent surface lets the page
 * gradient read through while the backdrop blur de-noises scrolled content.
 * The specular ::before / ::after rim layers, the scroll-edge mask, and the
 * reduced-transparency / forced-colors fallbacks mirror the other Liquid
 * Glass surfaces (see `bottomTabBar`). Block padding steps up at md / lg so
 * the icons sit in the optical centre of a taller band on desktop.
 */
const HEADER_CLASS = cn(
    "sticky top-0 z-10 flex items-center justify-between gap-xs",
    "[background:var(--glass-surface-subtle)] [border-bottom:1px_solid_var(--glass-border)]",
    "[backdrop-filter:var(--pulse-backdrop-filter-glass)] [-webkit-backdrop-filter:var(--pulse-backdrop-filter-glass)]",
    "[view-transition-name:pulse-header]",
    "[padding:2px_12px]",
    "[padding-block-start:max(2px,env(safe-area-inset-top))]",
    "[padding-inline-start:max(12px,env(safe-area-inset-left))]",
    "[padding-inline-end:max(12px,env(safe-area-inset-right))]",
    "pb-[12px]",
    "[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent_100%)]",
    "[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent_100%)]",
    // Top-leading specular rim + companion bottom-trailing trough.
    "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:bg-[image:var(--glass-specular-top)] before:content-['']",
    "after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:bg-[image:var(--glass-specular-bottom)] after:content-['']",
    "[&>*]:relative [&>*]:z-[1]",
    // Honor reduced-transparency: collapse to the solid page background.
    "[@media(prefers-reduced-transparency:reduce)]:[background:var(--page-background)]",
    "[@media(prefers-reduced-transparency:reduce)]:[background-attachment:fixed]",
    "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none]",
    "[@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none]",
    "[@media(prefers-reduced-transparency:reduce)]:pb-0",
    "[@media(prefers-reduced-transparency:reduce)]:[mask-image:none]",
    "[@media(prefers-reduced-transparency:reduce)]:[-webkit-mask-image:none]",
    "[@media(prefers-reduced-transparency:reduce)]:before:bg-none",
    "[@media(prefers-reduced-transparency:reduce)]:after:bg-none",
    // Forced-colors (Windows high-contrast) drops the achromatic rim.
    "forced-colors:pb-0 forced-colors:[mask-image:none] forced-colors:[-webkit-mask-image:none]",
    "forced-colors:before:bg-none forced-colors:after:bg-none",
    // Responsive padding ramp (token breakpoints sm=480, md=768, lg=1024).
    "min-[480px]:[padding-inline:16px]",
    "min-[480px]:[padding-inline-start:max(16px,env(safe-area-inset-left))]",
    "min-[480px]:[padding-inline-end:max(16px,env(safe-area-inset-right))]",
    "md:[padding-block:8px] md:[padding-inline:24px]",
    "md:[padding-inline-start:max(24px,env(safe-area-inset-left))]",
    "md:[padding-inline-end:max(24px,env(safe-area-inset-right))]",
    "lg:[padding-block:12px]"
);

/*
 * Soft pill-shaped trigger for the account dropdown. 36 px on desktop, a
 * full 44 px coarse-pointer target for touch. The gel-flex micro-press
 * yields ~3 % under press then springs back; transform-only so the hit area
 * (computed from layout) is unaffected on coarse pointers.
 */
const PILL_TRIGGER_CLASS = cn(
    "inline-flex flex-[0_1_auto] items-center gap-xs h-9 max-w-full min-w-0 px-xs sm:px-sm",
    "rounded-pill border-none bg-transparent [color:inherit] [font:inherit] cursor-pointer",
    "will-change-transform",
    "[transition:background-color_120ms_ease-out,color_120ms_ease-out,transform_var(--motion-gel-flex,220ms)_var(--easing-spring-snap,ease-out)]",
    "hover:[background:var(--pulse-bg-text-hover,rgba(15,23,42,0.05))]",
    "focus-visible:[background:var(--pulse-bg-text-hover,rgba(15,23,42,0.05))]",
    "active:scale-[0.97]",
    "motion-reduce:[transition:background-color_120ms_ease-out,color_120ms_ease-out] motion-reduce:active:scale-100",
    "coarse:h-[44px]"
);

/*
 * Square icon button (inline theme toggle). Shares the pill's gel-flex
 * press recovery; the layout box stays intact under transform so the
 * 44×44 coarse-pointer hit area is preserved.
 */
const ICON_BUTTON_CLASS = cn(
    "inline-flex h-9 w-9 items-center justify-center p-0 rounded-md",
    "[color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]",
    "border-none bg-transparent cursor-pointer will-change-transform",
    "[transition:background-color_120ms_ease-out,color_120ms_ease-out,transform_var(--motion-gel-flex,220ms)_var(--easing-spring-snap,ease-out)]",
    "hover:[background:var(--pulse-bg-text-hover,rgba(15,23,42,0.05))] hover:[color:var(--pulse-text-base,rgba(15,23,42,0.9))]",
    "focus-visible:[background:var(--pulse-bg-text-hover,rgba(15,23,42,0.05))] focus-visible:[color:var(--pulse-text-base,rgba(15,23,42,0.9))]",
    "active:scale-[0.97]",
    "motion-reduce:[transition:background-color_120ms_ease-out,color_120ms_ease-out] motion-reduce:active:scale-100",
    "coarse:h-[44px] coarse:w-[44px]",
    "[&_svg]:size-[18px]"
);

/*
 * Brand cluster — `BrandMark` wrapped in a link-styled `Button` so it stays
 * keyboard-focusable and announces "Pulse, link". The gel-flex press mirrors
 * the pill / icon buttons; on the narrowest viewports the wordmark collapses
 * to its glyph. `!p-0` / fixed heights override the primitive's defaults.
 */
const BRAND_LINK_CLASS = cn(
    "inline-flex flex-[0_1_auto] items-center min-w-0 h-9 !p-0",
    "will-change-transform",
    "[transition:color_100ms_ease-in-out,background_100ms_ease-in-out,border-color_100ms_ease-in-out,box-shadow_100ms_ease-in-out,transform_var(--motion-gel-flex,220ms)_var(--easing-spring-snap,ease-out)]",
    "active:scale-[0.97]",
    "motion-reduce:[transition:none] motion-reduce:active:scale-100",
    "coarse:h-[44px] coarse:min-w-[44px] coarse:justify-center",
    "[@media(max-width:479px)]:[&>span>span:last-child]:hidden"
);

/*
 * A single primary-nav link. `NavLink` emits `aria-current="page"` on the
 * active route; the `aria-[current=page]` utilities give that a filled-pill
 * treatment. Forced-colors re-draws the pill with a system-color border so
 * the current tab stays distinguishable when the translucent fill is
 * stripped.
 */
const NAV_TAB_CLASS = cn(
    "inline-flex items-center gap-xxs h-8 px-sm rounded-pill no-underline whitespace-nowrap",
    "text-sm font-medium leading-tight",
    "[color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]",
    "[transition:background-color_120ms_ease-out,color_120ms_ease-out]",
    "hover:[background:var(--pulse-bg-text-hover,rgba(15,23,42,0.05))] hover:[color:var(--pulse-text-base,rgba(15,23,42,0.9))]",
    "focus-visible:[background:var(--pulse-bg-text-hover,rgba(15,23,42,0.05))] focus-visible:[color:var(--pulse-text-base,rgba(15,23,42,0.9))]",
    "aria-[current=page]:[background:var(--pulse-bg-text-active,rgba(15,23,42,0.08))]",
    "aria-[current=page]:[color:var(--pulse-text-base,rgba(15,23,42,0.95))]",
    "aria-[current=page]:font-semibold",
    "forced-colors:aria-[current=page]:border forced-colors:aria-[current=page]:border-[CanvasText]",
    "coarse:h-[44px]",
    "max-md:px-xs",
    "[&_svg]:size-4"
);

/**
 * Top-level destinations surfaced in the header primary nav. Mirrors the
 * routed `<BottomTabBar>` route tabs (minus the Search action and the
 * Profile/Settings entry, which the account dropdown already covers) so the
 * two navigation surfaces stay in sync. `end: false` on Projects keeps the
 * tab active on nested board / project-detail routes.
 */
const PRIMARY_NAV_TABS = [
    {
        to: "/projects",
        labelKey: "boards" as const,
        icon: <LayoutGrid aria-hidden />,
        end: false
    },
    {
        to: "/inbox",
        labelKey: "inbox" as const,
        icon: <Inbox aria-hidden />,
        end: true
    },
    {
        to: "/copilot",
        labelKey: "copilot" as const,
        icon: <Bot aria-hidden />,
        end: true
    }
];

/**
 * Small status dot that appears only when the AI backend is `degraded` or
 * `offline`. Hidden when the local engine is active or AI is disabled — no
 * point polling a server the FE doesn't use.
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
        <span
            aria-label={label}
            className={cn(
                "inline-block size-2 flex-none rounded-full",
                status === "offline"
                    ? "[background:var(--pulse-error,#EF4444)]"
                    : "[background:var(--pulse-warning,#F59E0B)]"
            )}
            role="img"
            title={label}
        />
    );
};

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
     * touching the demoted dropdown.
     */
    const { unreadCount } = useActivityFeed();
    const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
    /*
     * Notifications (backend Notifications feature). A second bell beside
     * the activity-feed bell, backed by the server's persisted
     * notifications. Its drawer body mounts once below the header chrome.
     */
    const { unreadCount: notificationUnreadCount } = useNotifications();
    const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
    /*
     * Phase 3 A3 — phone demotion. The flag-gated `bottomNavEnabled`
     * env switch composes with the shared `useIsPhoneChrome` predicate
     * so the right-cluster only hides when (a) the bottom-tab chassis
     * is rolled out AND (b) the user is on a coarse-pointer surface
     * where the bar actually mounts.
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
     * so secondary sticky chrome can stick at `top: var(--header-height)`
     * without hard-coding the offset. ResizeObserver covers safe-area
     * changes, breakpoint-driven padding shifts, and zoom.
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

    return (
        <header
            className={HEADER_CLASS}
            data-glass-context="true"
            ref={headerRef}
        >
            <div
                className={cn(
                    "flex items-center gap-xs min-w-0 md:gap-md",
                    titleCentered ? "flex-1" : "flex-auto"
                )}
            >
                <Button
                    aria-label={microcopy.header.logoLabel}
                    className={BRAND_LINK_CLASS}
                    onClick={
                        path !== "/projects"
                            ? () =>
                                  navigate("/projects", {
                                      viewTransition: true
                                  })
                            : undefined
                    }
                    title={microcopy.header.logoLabel}
                    variant="link"
                >
                    <BrandMark size="sm" />
                </Button>
                {/*
                 * Primary navigation. Suppressed in phone chrome where the
                 * routed BottomTabBar owns the primary-navigation landmark.
                 * Hidden when the contextual mobile title is centered so the
                 * three flex thirds stay balanced.
                 */}
                {!isPhoneChrome && !titleCentered && (
                    <nav
                        aria-label={microcopy.nav.desktopNavLabel}
                        className="flex items-center gap-xxs min-w-0 [@media(max-width:479px)]:hidden"
                    >
                        {PRIMARY_NAV_TABS.map((tab) => (
                            <NavLink
                                className={NAV_TAB_CLASS}
                                end={tab.end}
                                key={tab.to}
                                to={tab.to}
                            >
                                {tab.icon}
                                <span className="max-md:hidden">
                                    {microcopy.nav.tabs[tab.labelKey]}
                                </span>
                            </NavLink>
                        ))}
                    </nav>
                )}
            </div>
            {mobileTitle !== null && (
                <div className="flex flex-1 items-center justify-center min-w-0 pointer-events-none">
                    <span
                        className={cn(
                            "max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
                            "text-md font-semibold leading-tight tracking-tight",
                            "[color:var(--pulse-text-base,rgba(15,23,42,0.9))]",
                            "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
                        )}
                        key={mobileTitle}
                    >
                        {mobileTitle}
                    </span>
                </div>
            )}
            <div
                className={cn(
                    "flex items-center flex-none gap-xxs md:gap-xs",
                    titleCentered && "flex-1 justify-end"
                )}
            >
                {environment.aiEnabled && (
                    <span className="hidden md:inline">
                        <EngineModeTag />
                    </span>
                )}
                {environment.aiEnabled && !environment.aiUseLocalEngine && (
                    <AgentHealthBadge />
                )}
                {/*
                 * Phase 4.3 — activity feed bell. Renders on every viewport
                 * (except demoted phone chrome) so the drawer is reachable
                 * from anywhere; the drawer itself lives below the header
                 * chrome so its bottom-sheet placement clears the tab bar.
                 */}
                {environment.activityFeedEnabled &&
                    !(environment.bottomNavEnabled && isPhoneChrome) && (
                        <ActivityFeedBell
                            unreadCount={unreadCount}
                            onClick={() =>
                                setActivityDrawerOpen((prev) => !prev)
                            }
                        />
                    )}
                {/*
                 * Notifications bell (backend Notifications feature). Sits
                 * beside the activity-feed bell and is likewise visible on
                 * every viewport so server notifications stay reachable.
                 */}
                <NotificationBell
                    unreadCount={notificationUnreadCount}
                    onClick={() => setNotificationDrawerOpen((prev) => !prev)}
                />
                {/*
                 * Phone-demotion wrapper. With the bottom-tab chassis active
                 * (flag default ON), theme + account controls move to the
                 * routed Settings page reachable from the Profile tab. The
                 * span stays in the DOM either way so the JSX shape is stable
                 * for tests; visibility toggles from JS (the shared
                 * `useIsPhoneChrome` predicate) rather than a CSS media query.
                 */}
                <span className={cn(rightClusterHidden && "hidden")}>
                    <button
                        aria-label={
                            scheme === "dark"
                                ? microcopy.a11y.useLightMode
                                : microcopy.a11y.useDarkMode
                        }
                        className={ICON_BUTTON_CLASS}
                        onClick={() =>
                            setPreference(scheme === "dark" ? "light" : "dark")
                        }
                        type="button"
                    >
                        {scheme === "dark" ? (
                            <Sun aria-hidden />
                        ) : (
                            <Moon aria-hidden />
                        )}
                    </button>
                </span>
                <span className={cn(rightClusterHidden && "hidden")}>
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                aria-label={microcopy.a11y.accountMenuFor.replace(
                                    "{name}",
                                    user?.username ?? ""
                                )}
                                className={PILL_TRIGGER_CLASS}
                                type="button"
                            >
                                <UserAvatar
                                    id={user?._id ?? user?.username ?? "anon"}
                                    name={user?.username}
                                    size="small"
                                />
                                <span className="hidden sm:inline">
                                    <Typography.Text className="font-medium max-w-[14ch] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                        {microcopy.greeting.replace(
                                            "{name}",
                                            user?.username ?? ""
                                        )}
                                    </Typography.Text>
                                </span>
                                <ChevronDown
                                    aria-hidden
                                    className="hidden size-[10px] md:inline [color:var(--pulse-text-tertiary,rgba(15,23,42,0.45))]"
                                />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            aria-label={microcopy.a11y.accountMenuFor.replace(
                                "{name}",
                                user?.username ?? ""
                            )}
                            className="flex w-auto min-w-[240px] flex-col gap-xxs p-xxs"
                        >
                            {aiAvailable && (
                                <div className="flex items-center justify-between gap-sm px-xs py-xxs">
                                    <span className="inline-flex items-center gap-xs">
                                        <Lightbulb
                                            aria-hidden
                                            className="size-4"
                                        />
                                        <Typography.Text>
                                            {microcopy.settings.boardCopilot}
                                        </Typography.Text>
                                    </span>
                                    <Switch
                                        aria-label={
                                            microcopy.settings
                                                .toggleBoardCopilot
                                        }
                                        checked={aiEnabled}
                                        onCheckedChange={setAiEnabled}
                                    />
                                </div>
                            )}
                            <div className="px-xs py-xxs">
                                <LanguageSwitcher />
                            </div>
                            {/*
                             * Phase 5 Wave 2 T4 — user-facing glass-intensity
                             * toggle. Persists through the userPreferences
                             * slice on every dispatch, round-tripping to
                             * localStorage without further orchestration.
                             */}
                            <div className="px-xs py-xxs">
                                <GlassIntensitySelect />
                            </div>
                            <Separator className="my-xxs" />
                            <div className="px-xs py-xxs">
                                <Button
                                    aria-label={microcopy.actions.logOut}
                                    className="!h-auto justify-start !p-0"
                                    onClick={() => {
                                        logout();
                                    }}
                                    variant="link"
                                >
                                    <LogOut aria-hidden />
                                    {microcopy.actions.logOut}
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>
                </span>
            </div>
            {environment.activityFeedEnabled &&
                !(environment.bottomNavEnabled && isPhoneChrome) && (
                    <ActivityFeedDrawer
                        open={activityDrawerOpen}
                        onClose={() => setActivityDrawerOpen(false)}
                    />
                )}
            <NotificationDrawer
                open={notificationDrawerOpen}
                onClose={() => setNotificationDrawerOpen(false)}
            />
        </header>
    );
};

export default Header;
