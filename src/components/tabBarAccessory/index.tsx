import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { motion } from "../../theme/tokens";
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
 *   - `<TabBarAccessoryMount />` — the actual DOM slot, mounted above the
 *     `BottomTabBar` from `MainLayout`. The push side (`<TabBarAccessory>`)
 *     has no production consumer yet: it is a reserved primitive kept for
 *     the future active-state surfaces above (mini-player, active call).
 *     Intentionally unconsumed — not dead code.
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
 * camelCase (other test resets in the codebase use the
 * `__resetForTests` convention with a per-line `eslint-disable
 * no-underscore-dangle`; the suffix-only form here keeps the intent
 * without the disable directive).
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
 * CSS animations (not transitions) so the materialize fade-in runs on
 * the chrome's FIRST paint. A transition needs a prior state to
 * interpolate from — the chrome is unmounted before content arrives,
 * so there's no "from" state for a transition to use. Keyframes fire
 * unconditionally when the rule applies, giving us a real materialize
 * on mount and a real dematerialize on the exit pass (driven by the
 * deferred-unmount window in <TabBarAccessoryMount />).
 */
const ACCESSORY_KEYFRAMES = `
@keyframes pulse-tba-materialize {
    from { opacity: 0; transform: translateY(var(--pulse-space-sm)); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulse-tba-dematerialize {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(var(--pulse-space-sm)); }
}`;

/*
 * Idempotent portal-host installer. Lives outside the component so
 * the useState initializer can call it during render WITHOUT mutating
 * DOM at render time on subsequent renders — `document.getElementById`
 * short-circuits when the host already exists (StrictMode-safe).
 */
const ensureSlotHost = (): HTMLDivElement | null => {
    if (typeof document === "undefined") return null;
    let host = document.getElementById(SLOT_DOM_ID) as HTMLDivElement | null;
    if (!host) {
        host = document.createElement("div");
        host.id = SLOT_DOM_ID;
        document.body.appendChild(host);
    }
    return host;
};

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
 *
 * Materialize / dematerialize is driven by a TWO-STATE machine:
 *
 *   - `renderedNode` — what the chrome currently displays. Set
 *     immediately when content arrives; held for `motion.morph` ms
 *     after content departs so the dematerialize animation can play
 *     to completion before the chrome unmounts.
 *   - `exiting` — drives the keyframes pair: false = materialize
 *     (default), true = dematerialize.
 *
 * Without the deferred-unmount window, the chrome would pop out of the
 * tree the moment content left, with no chance for an exit animation.
 */
export const TabBarAccessoryMount: React.FC = () => {
    const [node, setNode] = useState<ReactNode | null>(currentNode);
    const [renderedNode, setRenderedNode] = useState<ReactNode | null>(node);
    const [exiting, setExiting] = useState<boolean>(false);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /*
     * Install the portal host via useState initializer so it happens
     * once per component lifetime, not on every render — and never as
     * a render-time side effect.
     */
    const [containerHost] = useState<HTMLDivElement | null>(ensureSlotHost);

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
     * Drive renderedNode / exiting from node:
     *   - content arrived (node !== null): mount chrome, animate in
     *   - content gone (node === null): flip to exiting, hold chrome
     *     mounted for motion.morph, then unmount
     */
    useEffect(() => {
        if (node !== null) {
            if (exitTimerRef.current !== null) {
                clearTimeout(exitTimerRef.current);
                exitTimerRef.current = null;
            }
            setRenderedNode(node);
            setExiting(false);
            return;
        }
        if (renderedNode === null) return;
        setExiting(true);
        exitTimerRef.current = setTimeout(() => {
            setRenderedNode(null);
            setExiting(false);
            exitTimerRef.current = null;
        }, motion.morph);
        return () => {
            if (exitTimerRef.current !== null) {
                clearTimeout(exitTimerRef.current);
                exitTimerRef.current = null;
            }
        };
    }, [node, renderedNode]);

    if (containerHost === null) return null;

    return createPortal(
        <div
            className={cn(
                "pointer-events-none fixed left-1/2 flex -translate-x-1/2 justify-center",
                "bottom-[calc(64px+env(safe-area-inset-bottom)+8px)]",
                "z-[15] w-[min(100%-48px,480px)]",
                "[view-transition-name:pulse-tab-accessory]"
            )}
            data-testid="tab-bar-accessory-slot"
        >
            <style>{ACCESSORY_KEYFRAMES}</style>
            {renderedNode !== null ? (
                <GlassPanel
                    aria-label="Tab bar accessory"
                    className={cn(
                        "w-full rounded-lg px-md py-sm",
                        "motion-reduce:[animation:none]",
                        exiting
                            ? "pointer-events-none [animation:pulse-tba-dematerialize_450ms_var(--pulse-ease-springSoft)_forwards] motion-reduce:opacity-0"
                            : "pointer-events-auto [animation:pulse-tba-materialize_450ms_var(--pulse-ease-springSoft)_forwards] motion-reduce:opacity-100"
                    )}
                    intensity="regular"
                    role="region"
                >
                    {renderedNode}
                </GlassPanel>
            ) : null}
        </div>,
        containerHost
    );
};

export default TabBarAccessory;
