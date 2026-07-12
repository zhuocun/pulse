import { Bot, Inbox, LayoutGrid, Search, User } from "lucide-react";
import { useRef } from "react";
import { NavLink, useLocation } from "react-router";

import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
import useHaptic from "../../utils/hooks/useHaptic";
import useKeyboardOpen from "../../utils/hooks/useKeyboardOpen";
import useScrollDirection from "../../utils/hooks/useScrollDirection";

/**
 * BottomTabBar — Phase 6 Wave 2 floating capsule refactor.
 *
 * Detached from the viewport bottom into an iOS-26 style floating
 * capsule: centred horizontally, fixed above the safe-area inset, and
 * shaped with `radius.pill` corners. The four primary destinations
 * (Boards / Inbox / Copilot / Profile) remain unchanged from the
 * Phase 3 A3 contract; the geometry, hide-mode, accessory mount, and
 * minimize-on-scroll behaviour are the Wave 2 additions.
 *
 * Phase 6 Wave 7 — a fifth "Search" tab joins the bar. Unlike the four
 * destinations it is an ACTION tab, not a route: activating it
 * dispatches a `commandPalette:open` event rather than navigating.
 * `TAB_DEFINITIONS` is a discriminated union (`kind: "route" |
 * "action"`) so the route tabs keep their `to` / `end` contract while
 * the action tab carries an `onActivate` callback instead.
 *
 * Markup — the route tabs are `<nav aria-label="Primary">` +
 * `<NavLink>`-per-tab (each emits `aria-current="page"` when active).
 * The Search action tab is a real `<button type="button">` styled to
 * match the links (same 56 px touch target, same focus ring).
 *
 * Keyboard hide — driven by `useKeyboardOpen()`. The bar over-translates
 * beyond the inset AND drops opacity to 0, and is gated `inert` while
 * hidden so it disappears from the a11y tree and accepts no pointer
 * events.
 *
 * Minimize-on-scroll — driven by `useScrollDirection()`. Scrolling DOWN
 * past a 50 px threshold sets `data-minimized="true"`; the labels fade
 * out and the bar shrinks. `prefers-reduced-motion` skips the animation
 * but still toggles the state.
 *
 * Haptic — `useHaptic().vibrate("tap")` fires on tab activation, but ONLY
 * when the active tab actually changes.
 *
 * Selection morph indicator — a positioned overlay
 * (`data-active-indicator`) sits behind the active tab and animates its
 * position between tabs via the View Transitions API.
 */

type TabLabelKey = keyof typeof microcopy.nav.tabs;

interface RouteTab {
    kind: "route";
    to: string;
    labelKey: TabLabelKey;
    icon: React.ReactNode;
    end: boolean;
}

interface ActionTab {
    kind: "action";
    labelKey: TabLabelKey;
    icon: React.ReactNode;
    onActivate: () => void;
}

type TabDefinition = RouteTab | ActionTab;

const TAB_DEFINITIONS: readonly TabDefinition[] = [
    {
        kind: "route",
        to: "/projects",
        labelKey: "boards",
        icon: <LayoutGrid aria-hidden />,
        end: false
    },
    {
        kind: "action",
        labelKey: "search",
        icon: <Search aria-hidden />,
        onActivate: () => {
            window.dispatchEvent(new CustomEvent("commandPalette:open"));
        }
    },
    {
        kind: "route",
        to: "/inbox",
        labelKey: "inbox",
        icon: <Inbox aria-hidden />,
        end: true
    },
    {
        kind: "route",
        to: "/copilot",
        labelKey: "copilot",
        icon: <Bot aria-hidden />,
        end: true
    },
    {
        kind: "route",
        to: "/settings",
        labelKey: "profile",
        icon: <User aria-hidden />,
        end: true
    }
];

/*
 * Inner padding the capsule shape uses on the block axis. Drives the
 * concentric-radius math and the indicator geometry.
 */
const INNER_PADDING = space.xxs;

/*
 * Shared tab presentation. Both the route tabs (a `NavLink`) and the
 * Search action tab (a `<button>`) draw from this class so the link and
 * the button are pixel-identical — same 56 px touch target, same
 * gel-flex press, same focus ring. The `aria-[current=page]` callout
 * only ever fires on the NavLink but lives in the shared class harmlessly.
 */
const TAB_CLASS = cn(
    "relative flex flex-1 flex-col items-center justify-center gap-[2px]",
    "min-h-[56px] min-w-0 rounded-[995px] px-xs py-xxs",
    "cursor-pointer border-none bg-transparent text-xs text-muted-foreground no-underline",
    "will-change-transform",
    "[transition:color_120ms_ease-out,transform_var(--motion-gel-flex,220ms)_var(--easing-spring-snap,ease-out)]",
    "aria-[current=page]:font-semibold aria-[current=page]:text-brand",
    "hover:text-foreground",
    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
    "active:scale-[0.97]",
    "motion-reduce:active:scale-100 motion-reduce:[transition:none]"
);

/*
 * Gate the haptic to a primary (unmodified left) click. Modifier /
 * middle clicks fall through to the browser opening a new tab, so they
 * shouldn't buzz.
 */
const isPrimaryClick = (event: React.MouseEvent<HTMLAnchorElement>): boolean =>
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.button === 0;

const BottomTabBar: React.FC = () => {
    const tabsRef = useRef<HTMLElement[]>([]);
    const location = useLocation();
    const keyboardOpen = useKeyboardOpen();
    const scrollDirection = useScrollDirection({
        threshold: 50,
        minStateDurationMs: 300,
        resetKey: location.pathname
    });
    const minimized = scrollDirection === "down";

    const { vibrate } = useHaptic();

    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        const tabs = tabsRef.current.filter((node): node is HTMLElement =>
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

    const activeIndex = TAB_DEFINITIONS.findIndex(
        (tab) =>
            tab.kind === "route" &&
            (tab.end
                ? location.pathname === tab.to
                : location.pathname === tab.to ||
                  location.pathname.startsWith(`${tab.to}/`))
    );
    const indicatorVisible = activeIndex >= 0;
    const indicatorStyle: React.CSSProperties = indicatorVisible
        ? {
              ["--indicator-left" as string]: `calc(${INNER_PADDING}px + ${activeIndex} * ((100% - ${INNER_PADDING * 2}px) / ${TAB_DEFINITIONS.length}))`,
              ["--indicator-width" as string]: `calc((100% - ${INNER_PADDING * 2}px) / ${TAB_DEFINITIONS.length})`
          }
        : { display: "none" };

    return (
        // Intentional container-level keyboard handler (`onKeyDown` below):
        // the nav landmark implements roving Arrow/Home/End focus movement
        // across its child tab links (an APG-style composite-widget
        // enhancement). The listener never handles activation — Enter/click
        // still fire on the individual links — so the non-interactive
        // landmark stays a pure focus router. jsx-a11y can't see that intent.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <nav
            aria-label={microcopy.nav.primaryLandmarkLabel}
            className={cn(
                "fixed left-1/2 z-[15] flex items-stretch rounded-pill border p-xxs",
                "-translate-x-1/2",
                "[background:var(--glass-surface-strong)] [border-color:var(--glass-border)]",
                "[backdrop-filter:var(--pulse-backdrop-filter-glass)] [-webkit-backdrop-filter:var(--pulse-backdrop-filter-glass)]",
                "shadow-[var(--pulse-shadow-glass-lifted)]",
                "bottom-[max(24px,calc(env(safe-area-inset-bottom)+12px))]",
                "w-[min(calc(100%-32px),480px)]",
                "[view-transition-name:pulse-tabbar]",
                keyboardOpen
                    ? "pointer-events-none translate-y-[calc(100%+env(safe-area-inset-bottom)+32px)] opacity-0"
                    : "pointer-events-auto translate-y-0 opacity-100",
                "[transition:opacity_120ms_ease-out,transform_var(--pulse-motion-tab-bar-minimize,280ms)_var(--pulse-easing-detent,ease-out)]",
                "motion-reduce:[transition:none]",
                "data-[minimized=true]:py-0",
                // Top-leading specular rim + companion bottom-trailing trough.
                "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:bg-[image:var(--glass-specular-top)] before:content-['']",
                "after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:bg-[image:var(--glass-specular-bottom)] after:content-['']",
                "[&>a]:relative [&>a]:z-[1] [&>button]:relative [&>button]:z-[1]",
                "[@media(prefers-reduced-transparency:reduce)]:[background:var(--page-background)]",
                "[@media(prefers-reduced-transparency:reduce)]:[background-attachment:fixed]",
                "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none]",
                "[@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none]",
                "[@media(prefers-reduced-transparency:reduce)]:before:bg-none",
                "[@media(prefers-reduced-transparency:reduce)]:after:bg-none",
                "forced-colors:before:bg-none forced-colors:after:bg-none"
            )}
            data-glass-context="true"
            data-minimized={minimized ? "true" : "false"}
            data-testid="bottom-tab-bar"
            // `inert` removes the subtree from the a11y tree AND blocks
            // pointer/focus in one declarative attribute.
            inert={keyboardOpen || undefined}
            onKeyDown={onKeyDown}
        >
            <span
                aria-hidden
                className={cn(
                    "pointer-events-none absolute bottom-xxs top-xxs z-0 block rounded-[995px] bg-muted",
                    "left-[var(--indicator-left,0)] w-[var(--indicator-width,0)]",
                    "[view-transition-name:pulse-tab-indicator]",
                    "[transition:left_var(--pulse-motion-tab-bar-minimize,280ms)_var(--easing-spring-snap,ease-out),width_var(--pulse-motion-tab-bar-minimize,280ms)_var(--easing-spring-snap,ease-out)]",
                    "motion-reduce:[transition:none]",
                    "forced-colors:bg-[CanvasText] forced-colors:opacity-15"
                )}
                data-active-indicator
                style={indicatorStyle}
            />
            {TAB_DEFINITIONS.map((tab, idx) => {
                const body = (
                    <>
                        <span
                            className={cn(
                                "inline-flex origin-center items-center justify-center leading-none",
                                "[&_svg]:size-[22px]",
                                "[transition:transform_var(--pulse-motion-tab-bar-minimize,280ms)_var(--pulse-easing-detent,ease-out)]",
                                "motion-reduce:[transition:none]",
                                minimized ? "scale-[0.82]" : "scale-100"
                            )}
                        >
                            {tab.icon}
                        </span>
                        <span
                            className={cn(
                                "max-w-full overflow-hidden text-ellipsis whitespace-nowrap leading-[13.2px]",
                                "[transition:opacity_var(--pulse-motion-tab-bar-minimize,280ms)_var(--pulse-easing-detent,ease-out),max-height_var(--pulse-motion-tab-bar-minimize,280ms)_var(--pulse-easing-detent,ease-out)]",
                                "motion-reduce:[transition:none]",
                                minimized
                                    ? "max-h-0 opacity-0"
                                    : "max-h-[1.5em] opacity-100"
                            )}
                        >
                            {microcopy.nav.tabs[tab.labelKey]}
                        </span>
                    </>
                );
                const tabAriaLabel =
                    tab.labelKey === "inbox"
                        ? microcopy.nav.inboxTabAriaLabel
                        : microcopy.nav.tabs[tab.labelKey];
                const viewTransitionStyle: React.CSSProperties = {
                    ["viewTransitionName" as string]: `pulse-tab-${tab.labelKey}`
                };

                if (tab.kind === "action") {
                    return (
                        <button
                            aria-label={tabAriaLabel}
                            className={cn(
                                TAB_CLASS,
                                "appearance-none text-center [font-family:inherit]"
                            )}
                            key={`action-${tab.labelKey}`}
                            onClick={() => {
                                vibrate("tap");
                                tab.onActivate();
                            }}
                            ref={(node: HTMLButtonElement | null) => {
                                tabsRef.current[idx] = node as HTMLElement;
                            }}
                            style={viewTransitionStyle}
                            type="button"
                        >
                            {body}
                        </button>
                    );
                }

                const isActive = tab.end
                    ? location.pathname === tab.to
                    : location.pathname === tab.to ||
                      location.pathname.startsWith(`${tab.to}/`);
                return (
                    <NavLink
                        aria-label={tabAriaLabel}
                        className={TAB_CLASS}
                        end={tab.end}
                        key={tab.to}
                        onClick={(event) => {
                            if (isActive || !isPrimaryClick(event)) return;
                            vibrate("tap");
                        }}
                        ref={(node: HTMLAnchorElement | null) => {
                            tabsRef.current[idx] = node as HTMLElement;
                        }}
                        style={viewTransitionStyle}
                        to={tab.to}
                        viewTransition
                    >
                        {body}
                    </NavLink>
                );
            })}
        </nav>
    );
};

export default BottomTabBar;
