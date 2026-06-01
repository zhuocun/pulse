import {
    AppstoreOutlined,
    InboxOutlined,
    RobotOutlined,
    SearchOutlined,
    UserOutlined
} from "@ant-design/icons";
import { css } from "@emotion/react";
import styled from "@emotion/styled";
import { useRef } from "react";
import { NavLink, useLocation } from "react-router";

import { microcopy } from "../../constants/microcopy";
import {
    brand,
    chromeInset,
    fontSize,
    fontWeight,
    motion,
    radius,
    radiusConcentric,
    space,
    zIndex
} from "../../theme/tokens";
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
 * dispatches a `commandPalette:open` event (the `App.tsx` listener
 * opens the palette; on phone that's the Wave 4 bottom-anchored
 * search) rather than navigating. This also closes a real gap — phone
 * users previously had no launcher for the palette (Cmd/Ctrl+K only).
 * `TAB_DEFINITIONS` is a discriminated union (`kind: "route" |
 * "action"`) so the route tabs keep their `to` / `end` contract while
 * the action tab carries an `onActivate` callback instead. Because the
 * action tab has no route it is never `aria-current`, and the morphing
 * indicator (keyed on `pathname`) never sits on it.
 *
 * Markup choice — the route tabs are `<nav role="navigation"
 * aria-label="Primary">` + `<NavLink>`-per-tab rather than the ARIA
 * `tablist` / `tab` pattern. Each is a route, not a panel pivot inside
 * one page, so the NavLink / `aria-current` contract is the more
 * accurate semantic. `<NavLink>` emits the active state via
 * `aria-current="page"`, which AT consumers already recognise. The
 * Search action tab is a real `<button type="button">` styled to
 * match the links (same 56 px touch target, same focus ring) — a
 * button is the correct semantic for an in-place action with no URL,
 * and it is keyboard-activatable (Enter / Space) for free.
 *
 * Keyboard hide — driven by `useKeyboardOpen()`, the single source of
 * truth for the keyboard-open predicate. With the floating geometry a
 * plain `translateY(100%)` no longer fully hides the bar (it peeks
 * above the safe-area inset and the bottom gap), so the hide-state
 * over-translates beyond the inset AND drops opacity to 0. The bar
 * is also gated `inert` while hidden so it disappears from the a11y
 * tree and accepts no pointer events.
 *
 * Minimize-on-scroll — driven by `useScrollDirection()`. Scrolling
 * DOWN past a 50 px threshold sets `data-minimized="true"` on the
 * nav root; the tab labels fade out (opacity 0 over
 * `motion.tabBarMinimize` 280 ms) and the bar shrinks vertically by
 * a small amount so it reads as compact-but-present. Scrolling UP
 * restores. `prefers-reduced-motion` skips the animation but still
 * toggles the state (the layout change remains discoverable to
 * keyboard / AT users). The hook also pauses during in-flight view
 * transitions so route changes don't snapshot the bar mid-minimize.
 *
 * Haptic — `useHaptic().vibrate("tap")` fires on tab activation, but
 * ONLY when the active tab actually changes. Re-tapping the active
 * tab is a no-op (matches iOS behaviour) and must not produce a
 * spurious buzz.
 *
 * Selection morph indicator — a positioned overlay
 * (`data-active-indicator`) sits behind the active tab and animates
 * its position between tabs via the View Transitions API: each tab
 * carries `view-transition-name: pulse-tab-${labelKey}` and the
 * indicator carries `view-transition-name: pulse-tab-indicator`. The
 * browser then morphs the indicator from one tab to the other on the
 * route change. Honours `prefers-reduced-motion` via the
 * media-query block (no transition).
 */

/*
 * Tab model. Most tabs are routes (`kind: "route"`) carrying the
 * NavLink `to` / `end` contract; the Search tab is an action
 * (`kind: "action"`) that runs `onActivate` instead of navigating. The
 * discriminated union keeps each variant minimally typed — a route tab
 * can't omit `to`, an action tab can't carry one — and the render +
 * indicator logic narrows on `kind`. `labelKey` keys into
 * `microcopy.nav.tabs`; the literal union keeps that lookup typed.
 */
type TabLabelKey = keyof typeof microcopy.nav.tabs;

interface RouteTab {
    kind: "route";
    to: string;
    labelKey: TabLabelKey;
    icon: React.ReactNode;
    /* `end={false}` on /projects keeps the Boards tab active on nested
     * routes ('/projects/:id/board'); the others require an exact
     * match. */
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
        icon: <AppstoreOutlined aria-hidden />,
        end: false
    },
    {
        /*
         * Search sits right after Boards: it's a global utility rather
         * than a personal destination, so it pairs naturally beside the
         * primary browse surface (mirrors iOS apps that place search
         * early) while the user-centric tabs (Inbox / Copilot /
         * Profile) stay clustered with Profile anchored last.
         */
        kind: "action",
        labelKey: "search",
        icon: <SearchOutlined aria-hidden />,
        onActivate: () => {
            window.dispatchEvent(new CustomEvent("commandPalette:open"));
        }
    },
    {
        kind: "route",
        to: "/inbox",
        labelKey: "inbox",
        icon: <InboxOutlined aria-hidden />,
        end: true
    },
    {
        kind: "route",
        to: "/copilot",
        labelKey: "copilot",
        icon: <RobotOutlined aria-hidden />,
        end: true
    },
    {
        kind: "route",
        to: "/settings",
        labelKey: "profile",
        icon: <UserOutlined aria-hidden />,
        end: true
    }
];

/*
 * Inner padding the capsule shape uses on the block axis. Pulled into a
 * named constant so the concentric-radius math reads as
 * `radiusConcentric(outer = pill, padding = INNER_PADDING)` rather
 * than threading a literal through three sites.
 */
const INNER_PADDING = space.xxs;

const Nav = styled.nav<{ $hidden: boolean; $minimized: boolean }>`
    align-items: stretch;
    /* Glass surface mirrors the header chrome. */
    background: var(--glass-surface-strong);
    /* Wave 2 T4 — consume the global intensity lever so the
     * user-facing toggle (Clear / Regular / Solid) re-tunes this bar
     * along with the rest of the chrome. Pixel-identical to the prior
     * blur(20px) saturate(180%) recipe at the default "regular"
     * intensity. */
    backdrop-filter: var(--ant-backdrop-filter-glass);
    -webkit-backdrop-filter: var(--ant-backdrop-filter-glass);
    border: 1px solid var(--glass-border);
    /*
     * Phase 6 Wave 2 — floating capsule geometry. The bar detaches
     * from the viewport bottom into a centred, pill-shaped chrome
     * sitting above the safe-area inset. Width clamps at 480 px
     * (matches the accessory slot clamp) with a 16 px breathing
     * gutter on either side via chromeInset.mobile.
     */
    border-radius: ${radius.pill}px;
    bottom: max(
        ${space.lg}px,
        calc(env(safe-area-inset-bottom) + ${space.sm}px)
    );
    /*
     * Phase 6 Wave 2 — lifted glass shadow. Per-mode value lives in
     * cssVars (--ant-shadow-glass-lifted) so the same recipe can scale
     * with any future floating glass surface. Light mode ships a
     * stronger ink than the achromatic shadow.lg token because the
     * cream page background (#fffaf5) drowns out the 6% inks
     * shadow.lg uses; dark mode keeps a softer recipe since the dark
     * glass already pops against the dark page chrome.
     */
    box-shadow: var(--ant-shadow-glass-lifted);
    display: flex;
    left: 50%;
    /*
     * Inner padding: capsule shape needs a touch of breathing room on
     * the block axis (touch targets stay at the existing 56 px minimum
     * via TabLink's min-height) and a small inline padding so the
     * leftmost / rightmost tabs don't kiss the rim.
     */
    padding: ${INNER_PADDING}px ${INNER_PADDING}px;
    position: fixed;
    /*
     * Width clamps to min(viewport minus inset, 480 px). Keeps the
     * bar comfortably wide on small phones and capped on tablets in
     * portrait so it doesn't sprawl across the whole width.
     */
    width: min(calc(100% - ${chromeInset.mobile * 2}px), 480px);
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
    /*
     * Hide-on-keyboard: with the floating geometry, plain
     * translateY(100%) no longer fully clears the bar (it would
     * still peek above the safe-area inset and the bottom gap). We
     * over-translate beyond the inset AND drop opacity so the bar
     * is fully invisible; pointer-events also lift so an
     * accidentally-still-tappable area can't intercept clicks while
     * hidden.
     */
    opacity: ${(props) => (props.$hidden ? 0 : 1)};
    pointer-events: ${(props) => (props.$hidden ? "none" : "auto")};
    transform: translateX(-50%)
        ${(props) =>
            props.$hidden
                ? `translateY(calc(100% + env(safe-area-inset-bottom) + ${space.xl}px))`
                : "translateY(0)"};
    transition:
        opacity ${motion.short}ms ease-out,
        transform var(--ant-motion-tab-bar-minimize, 280ms)
            var(--ant-easing-detent, ease-out);

    /*
     * Minimize-on-scroll: shrink slightly when scrolling down so the
     * bar reads as a tighter pill but stays present. Tab labels fade
     * out (handled in TabLabel below). The transform shrinks
     * vertically; we keep horizontal width steady (Apple keeps the
     * width or shifts it — leave width steady for v1).
     */
    &[data-minimized="true"] {
        /* Compact mode: tighten block padding so the capsule reads as
         * a slimmer pill. The TabLink keeps its min-height invariant
         * so the touch target never shrinks below the 56 px contract. */
        padding-block: 0;
    }

    /*
     * Phase 5 "Liquid Glass" Wave 2 — top-leading specular rim. The
     * 135deg axis catches the highlight on the bar's upper edge,
     * giving the capsule a luminous top arc consistent with the
     * header chrome's recipe. No scroll-edge dissolve here — the
     * capsule is fully detached from any scrolling content edge.
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

/*
 * Selection morph indicator. A pill-shaped overlay sits behind the
 * active tab. We pin it absolutely inside the nav and let CSS
 * variables (`--indicator-left`, `--indicator-width`) drive its
 * horizontal position. The viewTransition name is the cross-route
 * morph cue — when the active tab changes during a navigation that
 * the browser snapshots, the indicator slides from old → new.
 *
 * Inner concentric radius — `radiusConcentric(outer=pill, padding)`
 * resolves to a clamped value; since the outer is `pill` (effectively
 * infinite), the inner stays at the pill cap so the indicator's
 * corners hug the tab's hit area perfectly.
 */
const ActiveIndicator = styled.span`
    /* Soft glass pill behind the active tab. The fill stays neutral
     * (achromatic) so it reads as a "selection slot" rather than a
     * colored badge — the brand-orange typographic cue on the active
     * label is the colour callout; the indicator is the geometry
     * callout. */
    background: rgba(15, 23, 42, 0.05);
    border-radius: ${radiusConcentric(radius.pill, INNER_PADDING)}px;
    bottom: ${INNER_PADDING}px;
    display: block;
    left: var(--indicator-left, 0);
    pointer-events: none;
    position: absolute;
    top: ${INNER_PADDING}px;
    transition:
        left var(--ant-motion-tab-bar-minimize, 280ms)
            var(--easing-spring-snap, ease-out),
        width var(--ant-motion-tab-bar-minimize, 280ms)
            var(--easing-spring-snap, ease-out);
    view-transition-name: pulse-tab-indicator;
    width: var(--indicator-width, 0);
    z-index: 0;

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }

    @media (forced-colors: active) {
        background: CanvasText;
        opacity: 0.15;
    }
`;

/*
 * Shared tab presentation. Both the route tabs (`TabLink`, a styled
 * NavLink) and the Search action tab (`TabButton`, a styled
 * `<button>`) draw from this fragment so the link and the button are
 * pixel-identical — same 56 px touch target, same gel-flex press, same
 * focus ring. Extracted to a `css` fragment rather than duplicated so
 * the two render as one visual control with one source of truth. The
 * `&[aria-current="page"]` callout only ever fires on the NavLink (a
 * `<button>` never carries `aria-current` here) but lives in the
 * shared block harmlessly.
 */
const tabStyles = css`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radiusConcentric(radius.pill, INNER_PADDING)}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    cursor: pointer;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    font-size: ${fontSize.xs}px;
    gap: 2px;
    justify-content: center;
    /*
     * Touch-target invariant — 56 px stays the floor so a minimize
     * never shrinks the tap region below the WCAG-AA 44 px guidance.
     * The capsule's inner block padding (4 px each side) tops the
     * total bar height at ~64 px in the resting state.
     */
    min-height: 56px;
    /*
     * min-width: 0 is load-bearing on flex children — its default
     * value of "auto" blocks shrinking below the children's intrinsic
     * content width, so a too-long label (or icon + label in a tight
     * viewport) would push the rightmost tab past the capsule's
     * content box and clip the label off the right rim (the Phase 6
     * Wave 2 "Profile" regression). With 0, the flex distribution
     * honours the "flex: 1 1 0" contract literally — each tab gets
     * exactly 1/tabCount of the inner width and the label below
     * truncates with ellipsis as a defensive backstop. The prior
     * "min-width: 25vw" pinned every tab at >=98 px on a 393 px
     * viewport, summing to ~393 px of required width inside a ~353 px
     * content box.
     */
    min-width: 0;
    padding: ${space.xxs}px ${space.xs}px;
    position: relative;
    text-decoration: none;
    /*
     * Phase 5 "Liquid Glass" Wave 2 — gel-flex on bottom-tab taps.
     * Each tab yields on press for tactile parity with the header's
     * IconButton / PillTrigger. transform-only; layout box stays at
     * the 56 px floor so the min-height invariant is preserved.
     */
    transition:
        color ${motion.short}ms ease-out,
        transform var(--motion-gel-flex, 220ms)
            var(--easing-spring-snap, ease-out);
    will-change: transform;

    /* The active-state indicator is owned by ActiveIndicator (a
     * positioned overlay). We keep the colour / weight change here as
     * the textual / typographic "you are here" cue; the visual pill
     * morphing comes from the indicator overlay. */
    &[aria-current="page"] {
        color: ${brand.primary};
        font-weight: ${fontWeight.semibold};
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

const TabLink = styled(NavLink)`
    ${tabStyles}
`;

/*
 * The Search action tab. A real `<button>` (correct semantic for an
 * in-place action with no URL) styled identically to the route
 * NavLinks via the shared `tabStyles` fragment. `font: inherit`
 * neutralises the UA button font so the label matches the links;
 * `appearance: none` strips native chrome. Keyboard activation
 * (Enter / Space) comes free from the button element.
 */
const TabButton = styled.button`
    ${tabStyles}
    appearance: none;
    font: inherit;
    text-align: center;
`;

const TabIcon = styled.span<{ $minimized: boolean }>`
    /* Lift the icon to a comfortable size for thumb scanning. */
    align-items: center;
    display: inline-flex;
    font-size: ${fontSize.xl}px;
    justify-content: center;
    line-height: 1;
    /*
     * Minimize-on-scroll — the tap region is floored at 56 px (see
     * TabLink), so the bar can only lose its ~8 px block padding; that
     * alone reads as too subtle. Scale the icon down to give the
     * minimized state a second, unmistakable "compact" signal alongside
     * the label collapse. transform-only (no font-size reflow), pivots
     * on centre so the glyph stays put inside the floored tap region,
     * and the touch target is untouched.
     */
    transform: ${(props) => (props.$minimized ? "scale(0.82)" : "scale(1)")};
    transform-origin: center;
    transition: transform var(--ant-motion-tab-bar-minimize, 280ms)
        var(--ant-easing-detent, ease-out);

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`;

const TabLabel = styled.span<{ $minimized: boolean }>`
    line-height: ${fontSize.xs * 1.1}px;
    /*
     * Truncation defence — paired with min-width: 0 on TabLink, a
     * label that overruns its allotted slot degrades to an ellipsis
     * rather than visually clipping at the capsule rim. max-width:
     * 100% keeps the truncation calculation anchored to the parent's
     * flex-distributed width; nowrap prevents a line-wrap from
     * silently pushing the bar's block size beyond the touch-target
     * floor. Most locales will never hit this (Boards/Inbox/Copilot/
     * Profile are short) — this is the safety net for longer
     * translations.
     */
    max-width: 100%;
    /*
     * Minimize-on-scroll — labels fade out so the bar shrinks to
     * icon-only chrome. Opacity transition over motion.tabBarMinimize
     * so the change reads as a confident collapse rather than a snap.
     */
    opacity: ${(props) => (props.$minimized ? 0 : 1)};
    /*
     * Collapse the label out of layout when minimized so the icons
     * recentre vertically inside the slimmer capsule. max-height 0
     * pairs with overflow hidden so the transition is animatable;
     * height transitions don't animate without an explicit start /
     * end value.
     */
    max-height: ${(props) => (props.$minimized ? "0" : "1.5em")};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
        opacity var(--ant-motion-tab-bar-minimize, 280ms)
            var(--ant-easing-detent, ease-out),
        max-height var(--ant-motion-tab-bar-minimize, 280ms)
            var(--ant-easing-detent, ease-out);

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`;

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
    /*
     * Roving-focus registry. Holds both the route NavLinks (anchors)
     * and the Search action tab (a button), so the ←/→/Home/End
     * handler walks all five slots uniformly. Widened from
     * `HTMLAnchorElement[]` to `HTMLElement[]` for the mixed element
     * types — `.focus()` is the only method called, shared by both.
     */
    const tabsRef = useRef<HTMLElement[]>([]);
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
     * Minimize-on-scroll — `down` collapses the bar; anything else
     * (idle / up) restores. The hook owns the hysteresis, the
     * min-duration lockout, and the in-flight view-transition pause.
     */
    const scrollDirection = useScrollDirection({
        threshold: 50,
        minStateDurationMs: 300
    });
    const minimized = scrollDirection === "down";

    /*
     * Haptic feedback on tab activation. Fires only when the active
     * tab actually changes — re-tapping the same tab is a no-op so
     * the device doesn't buzz on every tap of the current
     * destination.
     */
    const { vibrate } = useHaptic();

    /*
     * Arrow-key navigation as a convenience. We use a <nav> landmark
     * with NavLinks + one action button (not the ARIA tablist
     * roving-tabindex pattern); each tab is independently Tab-reachable
     * so screen-reader users walk them as plain links / a button. ←/→
     * and Home/End move focus across the bar once the user has tabbed
     * in. Enter and Space activate via the browser element default.
     */
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

    /*
     * Determine the active tab index for the indicator overlay's
     * left + width vars. We resolve it the same way NavLink does
     * internally (exact match, or any prefix match when `end={false}`)
     * so the indicator and the aria-current attribute stay
     * synchronised. Action tabs (the Search button) have no route, so
     * they never match here — the indicator only ever tracks the
     * active ROUTE tab, keyed on `pathname`. When the only-ever-active
     * candidates miss (e.g. an unknown path) `activeIndex` is -1 and
     * the indicator hides entirely.
     */
    const activeIndex = TAB_DEFINITIONS.findIndex(
        (tab) =>
            tab.kind === "route" &&
            (tab.end
                ? location.pathname === tab.to
                : location.pathname === tab.to ||
                  location.pathname.startsWith(`${tab.to}/`))
    );
    /*
     * Indicator geometry — width is a fraction of the bar's inner
     * width (1 / tabCount), left is index * width. Computed in CSS
     * via `calc()` and CSS custom props so the indicator stays
     * correctly positioned across resizes without a JS resize
     * listener.
     */
    const indicatorVisible = activeIndex >= 0;
    const indicatorStyle: React.CSSProperties = indicatorVisible
        ? {
              ["--indicator-left" as string]: `calc(${INNER_PADDING}px + ${activeIndex} * ((100% - ${INNER_PADDING * 2}px) / ${TAB_DEFINITIONS.length}))`,
              ["--indicator-width" as string]: `calc((100% - ${INNER_PADDING * 2}px) / ${TAB_DEFINITIONS.length})`
          }
        : { display: "none" };

    return (
        <Nav
            $hidden={keyboardOpen}
            $minimized={minimized}
            data-minimized={minimized ? "true" : "false"}
            // `inert` removes the subtree from the a11y tree AND blocks
            // pointer/focus in one declarative attribute — replaces the
            // legacy aria-hidden+tabIndex=-1 hand-rolled pattern.
            inert={keyboardOpen || undefined}
            aria-label={microcopy.nav.primaryLandmarkLabel}
            data-glass-context="true"
            data-testid="bottom-tab-bar"
            onKeyDown={onKeyDown}
        >
            <ActiveIndicator
                aria-hidden
                data-active-indicator
                style={indicatorStyle}
            />
            {TAB_DEFINITIONS.map((tab, idx) => {
                /*
                 * Tab body (icon + label) is shared between the route
                 * link and the action button — same markup, same
                 * minimize wiring — so the two render identically.
                 */
                const body = (
                    <>
                        <TabIcon $minimized={minimized}>{tab.icon}</TabIcon>
                        <TabLabel $minimized={minimized}>
                            {microcopy.nav.tabs[tab.labelKey]}
                        </TabLabel>
                    </>
                );
                /*
                 * View-transition name is per-tab so the morph
                 * indicator can slide between them. React's inline
                 * `style` prop expects camelCase — kebab-case
                 * `view-transition-name` triggers an "Unsupported
                 * style property" warning on every render; the cast
                 * keeps the key tolerant of `CSSProperties` typings
                 * that predate `viewTransitionName`. The styled CSS
                 * strings keep kebab-case (plain CSS, not React props).
                 */
                const viewTransitionStyle: React.CSSProperties = {
                    ["viewTransitionName" as string]: `pulse-tab-${tab.labelKey}`
                };

                // The Search action tab: a real <button> that opens the
                // command palette instead of navigating. It carries no
                // route, so it's never aria-current and the indicator
                // never sits on it. Same haptic the route tabs fire.
                if (tab.kind === "action") {
                    return (
                        <TabButton
                            key={`action-${tab.labelKey}`}
                            type="button"
                            aria-label={microcopy.nav.tabs[tab.labelKey]}
                            onClick={() => {
                                vibrate("tap");
                                tab.onActivate();
                            }}
                            ref={(node: HTMLButtonElement | null) => {
                                tabsRef.current[idx] = node as HTMLElement;
                            }}
                            style={viewTransitionStyle}
                        >
                            {body}
                        </TabButton>
                    );
                }

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
                            // Haptic ONLY when navigation will actually
                            // happen — re-tapping the current tab is
                            // intentionally silent (matches iOS), and
                            // modifier-clicks fall through to the browser
                            // opening a new tab via the anchor `href`.
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
                    </TabLink>
                );
            })}
        </Nav>
    );
};

export default BottomTabBar;
