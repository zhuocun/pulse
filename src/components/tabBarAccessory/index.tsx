import styled from "@emotion/styled";
import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type ReactNode
} from "react";
import { createPortal } from "react-dom";

import { easing, motion, radius, space, zIndex } from "../../theme/tokens";
import GlassPanel from "../glassPanel";

/**
 * TabBarAccessory — Phase 6 Wave 2 T6.
 *
 * iOS 26 introduces `tabViewBottomAccessory`: a persistent slot above the
 * tab bar for "active state" surfaces (a mini-player, an active call,
 * directions in progress). The web equivalent is a portal-rendered slot
 * that any subtree can opt into.
 *
 * Two pieces ship here:
 *
 *   - `<TabBarAccessory>{children}</TabBarAccessory>` — a sourceless
 *     component declared anywhere in the React tree. Whatever it
 *     receives as `children` is teleported into the mount point
 *     described below. Unmounting clears the slot.
 *   - `<TabBarAccessoryMount />` — the actual DOM slot. Worker C will
 *     mount this above the `BottomTabBar` in the Wave 2 refactor of
 *     `BottomTabBar` itself. We intentionally do NOT mount it from
 *     `MainLayout` here — that lives in Worker C's diff.
 *
 * Single-child contract — if two `<TabBarAccessory>` instances mount,
 * the LAST one wins (mini-player + active call simultaneously is an
 * edge case the iOS host also disallows; the simpler "last wins" rule
 * keeps the API predictable). A `console.warn` in dev fires when the
 * stack-replace happens so the caller can tell.
 *
 * Implementation — a module-singleton `currentNode` + a tiny pub/sub
 * (`subscribers: Set<Listener>`). `<TabBarAccessory>` writes to the
 * singleton on mount and notifies subscribers; `<TabBarAccessoryMount />`
 * subscribes and re-renders when the slot changes. We deliberately avoid
 * Context here — Context propagation depends on the consumer sitting
 * BELOW the provider in the tree, and the slot needs to live in a
 * sibling subtree (the `BottomTabBar` mounts in `MainLayout`, whereas
 * `<TabBarAccessory>` is declared inside a route page). A module
 * singleton is the simplest cross-tree primitive that doesn't drag
 * a Provider boundary into `MainLayout`.
 *
 * Glass chrome — `<GlassPanel intensity="regular">` only when content is
 * present; empty slot renders nothing (no role/region pollution in the
 * a11y tree, no empty visual frame).
 *
 * Materialize / dematerialize — opacity + translateY transition gated
 * on `motion.morph` (450ms) + `easing.springSoft` (the buoyant
 * overshoot curve registered in tokens for "panel appearing"
 * moments). Respects `prefers-reduced-motion`.
 *
 * View transition — `view-transition-name: pulse-tab-accessory` keeps
 * the slot pinned across route changes so a mini-player started on
 * `/projects` doesn't flicker on the way to `/inbox`. Name registered
 * in `tokens.ts` viewTransition block.
 */

type Listener = (node: ReactNode | null) => void;

interface SlotEntry {
    id: string;
    node: ReactNode;
}

/*
 * Stack of mounted entries. The TOP entry (last) is the visible one;
 * the rest stay queued so a "second instance unmounts before the first"
 * scenario restores the first instance's content instead of clearing
 * the slot entirely. This is the same LIFO ladder iOS uses for
 * overlapping accessory contexts (CarPlay/now-playing/active-call).
 */
const stack: SlotEntry[] = [];
const subscribers = new Set<Listener>();

const currentNode = (): ReactNode | null => {
    if (stack.length === 0) return null;
    return stack[stack.length - 1].node;
};

const notify = (): void => {
    const node = currentNode();
    subscribers.forEach((listener) => listener(node));
};

const subscribe = (listener: Listener): (() => void) => {
    subscribers.add(listener);
    return () => {
        subscribers.delete(listener);
    };
};

const push = (entry: SlotEntry): void => {
    /*
     * The "second instance replaces the first" warning fires when the
     * stack already has an entry. We don't warn on the same id
     * (re-render of an existing instance updating its children) — only
     * on a brand-new mount stacking on top.
     */
    if (
        stack.length > 0 &&
        process.env.NODE_ENV !== "production" &&
        !stack.some((e) => e.id === entry.id)
    ) {
        // eslint-disable-next-line no-console
        console.warn(
            "[TabBarAccessory] Multiple <TabBarAccessory> instances mounted; the last-mounted one wins. Unmount the previous instance before mounting a new one to avoid surprise stack-replace."
        );
    }
    const existing = stack.findIndex((e) => e.id === entry.id);
    if (existing >= 0) {
        stack[existing] = entry;
    } else {
        stack.push(entry);
    }
    notify();
};

const pop = (id: string): void => {
    const idx = stack.findIndex((e) => e.id === id);
    if (idx >= 0) stack.splice(idx, 1);
    notify();
};

/*
 * Test-only reset — clears the module singleton between tests so a
 * leaked mount from one case doesn't pollute the next. Not exposed
 * from the package barrel; the test file imports it directly. Plain
 * camelCase (rather than the conventional underscore-prefixed
 * `__resetForTests`) because the lint config forbids dangling
 * underscores; the `ForTests` suffix carries the same intent.
 */
export const resetTabBarAccessoryForTests = (): void => {
    stack.length = 0;
    notify();
};

/* -- TabBarAccessory (the source-side component) ---------------------- */

export interface TabBarAccessoryProps {
    children: ReactNode;
}

/**
 * Renders `children` into the tab-bar accessory slot mounted via
 * `<TabBarAccessoryMount />`. Declare anywhere in the React tree —
 * the children teleport via a module-level singleton, not React
 * Context. Returns `null` so it occupies no space at the declaration
 * site.
 */
const TabBarAccessory: React.FC<TabBarAccessoryProps> = ({ children }) => {
    /*
     * `useId` gives us a stable, per-instance key across re-renders.
     * Two reasons it matters:
     *
     *   - A re-render with new `children` should UPDATE the existing
     *     stack entry (no spurious "stack-replace" warning).
     *   - When this instance unmounts, we want to pop ONLY this
     *     instance's entry, not the top of the stack (which may
     *     belong to a sibling that mounted later).
     */
    const id = useId();

    useEffect(() => {
        push({ id, node: children });
        return () => {
            pop(id);
        };
        /*
         * Re-fire the push effect when children change so the slot
         * reflects the latest tree without remounting the host.
         * `id` is stable across renders so it does not retrigger.
         */
    }, [id, children]);

    return null;
};

/* -- TabBarAccessoryMount (the slot-side DOM) ------------------------- */

const SLOT_DOM_ID = "pulse-tab-accessory-slot";

/*
 * Position above the tab bar. The exact offset is a starting estimate —
 * Worker C will refine in their MainLayout body-padding work. The width
 * mirrors the floating tab-bar capsule's own clamp so the slot lines up
 * visually above it. The slot uses `pointer-events: auto` on its
 * children but no background until content arrives, so an empty mount
 * leaves the area transparent and click-through.
 */
const Slot = styled.div`
    bottom: calc(64px + env(safe-area-inset-bottom) + ${space.xs}px);
    display: flex;
    justify-content: center;
    left: 50%;
    pointer-events: none;
    position: fixed;
    transform: translateX(-50%);
    width: min(100% - ${space.lg * 2}px, 480px);
    /*
     * Sit at the same z tier as the tab bar's navBar layer (above
     * page content, below AntD overlays). The accessory is logically
     * part of the bottom-chrome stack; if a Drawer/Modal opens, both
     * the bar and accessory should disappear behind the dimmer.
     */
    z-index: ${zIndex.navBar};
    view-transition-name: pulse-tab-accessory;
`;

const GlassChrome = styled(GlassPanel)<{ $visible: boolean }>`
    border-radius: ${radius.lg}px;
    opacity: ${(p) => (p.$visible ? 1 : 0)};
    padding: ${space.sm}px ${space.md}px;
    pointer-events: ${(p) => (p.$visible ? "auto" : "none")};
    transform: ${(p) =>
        p.$visible ? "translateY(0)" : `translateY(${space.sm}px)`};
    transition:
        opacity ${motion.morph}ms ${easing.springSoft},
        transform ${motion.morph}ms ${easing.springSoft};
    width: 100%;

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`;

/**
 * The DOM mount point for the tab-bar accessory slot. Render exactly
 * once in the layout tree (Worker C will wire this above the
 * `BottomTabBar` in the Wave 2 refactor). Returns `null` until a
 * `<TabBarAccessory>` mounts somewhere in the React tree, then
 * portals the children into the glass chrome.
 *
 * We render the portal into `document.body` so the slot escapes any
 * `transform` / `filter` / `contain` ancestor that would otherwise
 * trap the fixed-position chrome inside a stacking context.
 */
export const TabBarAccessoryMount: React.FC = () => {
    const [node, setNode] = useState<ReactNode | null>(currentNode);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        /*
         * Initial sync — `useSyncExternalStore` would do this in one
         * call, but the manual subscribe + initial read avoids a
         * Suspense boundary and keeps the render path SSR-friendly.
         */
        setNode(currentNode());
        return subscribe(setNode);
    }, []);

    /*
     * Ensure a stable mount node lives on document.body so the
     * portal target survives across re-renders without re-creating
     * the DOM element (which would re-trigger view-transition
     * animations on every set).
     */
    useEffect(() => {
        if (typeof document === "undefined") return;
        let host = document.getElementById(SLOT_DOM_ID);
        if (!host) {
            host = document.createElement("div");
            host.id = SLOT_DOM_ID;
            document.body.appendChild(host);
        }
        containerRef.current = host as HTMLDivElement;
        // The mount has zero ownership of cleanup — multiple
        // <TabBarAccessoryMount /> instances would race on the
        // singleton DOM node, and Worker C will mount exactly one.
        // Leaving the node attached across unmounts means a HMR
        // boundary or test cleanup doesn't strand a half-removed
        // element on the page.
    }, []);

    if (typeof document === "undefined") return null;
    if (!containerRef.current) {
        /*
         * First render before the layout effect installs the host —
         * we still need to attach it now so the portal call below
         * has a target on the FIRST paint. Idempotent: the second
         * effect call short-circuits when the element already exists.
         */
        let host = document.getElementById(SLOT_DOM_ID);
        if (!host) {
            host = document.createElement("div");
            host.id = SLOT_DOM_ID;
            document.body.appendChild(host);
        }
        containerRef.current = host as HTMLDivElement;
    }

    const visible = node !== null;

    return createPortal(
        <Slot data-testid="tab-bar-accessory-slot">
            {visible ? (
                <GlassChrome
                    $visible={visible}
                    intensity="regular"
                    role="region"
                    aria-label="Tab bar accessory"
                >
                    {node}
                </GlassChrome>
            ) : null}
        </Slot>,
        containerRef.current
    );
};

export default TabBarAccessory;
