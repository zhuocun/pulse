import { useEffect, useRef, useState } from "react";

/**
 * useScrollDirection — Phase 6 Wave 2 T5.
 *
 * Returns the page's current scroll direction (`"up" | "down" | "idle"`)
 * with hysteresis and a minimum state duration so the result doesn't
 * thrash on rapid scroll reversals.
 *
 * Powers the BottomTabBar's minimize-on-scroll behaviour: when the user
 * scrolls down past a threshold, the bar shrinks to icon-only chrome;
 * when they scroll up, it restores. The hysteresis prevents the bar
 * from snapping minimized → restored → minimized in a single flick
 * (which would read as visual glitch).
 *
 * Tunables:
 *
 *   - `threshold` (default 50 px): the minimum cumulative scroll delta
 *     in a single direction before the hook flips. Smaller values feel
 *     snappy but flicker; larger values feel sluggish.
 *   - `minStateDurationMs` (default 300 ms): after a direction change,
 *     subsequent flips are blocked for this window. Pairs with the
 *     threshold to absorb the common "user briefly stops mid-scroll"
 *     pattern without toggling.
 *   - `pauseDuringViewTransition` (default true): when a
 *     `document.startViewTransition` call is in flight (React Router
 *     route change), pause direction updates. Concurrent
 *     minimize-on-scroll transforms during a view transition snapshot
 *     cause the snapshot to capture mid-animation and flicker on
 *     restore. Wave 2 T5 mitigation.
 *   - `resetKey`: when this value changes, direction resets to
 *     `"idle"`. The BottomTabBar passes `location.pathname` so a
 *     minimized bar never latches across navigations — landing on a
 *     new page always restores the full chrome.
 *
 * Top-of-page restore: any scroll event that lands at `scrollY <= 0`
 * forces the direction back to `"idle"` (bypassing the threshold and
 * the lockout). A bar minimized by a downward fling must not stay
 * minimized once the user is back at the very top — there is nothing
 * above to scroll up to, so the "scroll up to restore" affordance is
 * unreachable.
 *
 * Listener:
 *   - Subscribes to `window.scroll` with `{ passive: true }`. The
 *     handler reads `window.scrollY` (or
 *     `document.documentElement.scrollTop` as a fallback). We
 *     deliberately do NOT subscribe to `visualViewport.scroll` — that
 *     fires on URL-bar collapse / soft keyboard which would
 *     false-trigger the minimize without any actual page scroll.
 *
 * SSR-safe: returns `"idle"` when `typeof window === "undefined"`.
 *
 * Reduced motion: this hook does NOT consult
 * `prefers-reduced-motion` directly. The consumer (BottomTabBar)
 * inspects the preference and decides whether to ANIMATE the
 * minimize transition; the state toggle itself still fires so the
 * minimized layout remains accessible. Mixing the predicate here
 * would couple the hook to a CSS-feature concern that belongs in
 * the presentation layer.
 */

export type ScrollDirection = "up" | "down" | "idle";

export interface UseScrollDirectionOptions {
    /** Cumulative scroll delta required to flip direction (px). */
    threshold?: number;
    /** Minimum duration to hold a direction before re-toggling (ms). */
    minStateDurationMs?: number;
    /** Pause direction updates during in-flight view transitions. */
    pauseDuringViewTransition?: boolean;
    /** Direction resets to "idle" whenever this value changes. */
    resetKey?: unknown;
}

const isBrowser = (): boolean => typeof window !== "undefined";

const readScrollY = (): number => {
    if (!isBrowser()) return 0;
    return window.scrollY ?? document.documentElement?.scrollTop ?? 0;
};

/*
 * The shape of `document.startViewTransition` we care about — present
 * means the API is supported. The wrap we install when
 * `pauseDuringViewTransition` is true gates direction updates while
 * the returned transition's `finished` promise is in flight, so a
 * concurrent route change can't snapshot mid-minimize.
 *
 * We type the patched call permissively (rest args, unknown return)
 * so the wrap can forward any signature without coupling to the
 * spec's exact shape (which still varies across browsers as of 2026).
 * The `unknown` return is then narrowed at the call-site to the
 * minimal `{ finished?: Promise<unknown> }` we actually consume.
 */
type StartViewTransitionFn = (...args: unknown[]) => unknown;

/*
 * Mutable record we cast `document` to so the assignment isn't fought
 * by the lib.dom.d.ts declaration of `startViewTransition` (which is
 * a strict overloaded signature returning `ViewTransition`). The
 * patched value goes through this looser surface; reads stay
 * compatible with the strict declaration because the wrapper still
 * returns what the underlying impl returned.
 */
type DocumentWithViewTransition = {
    startViewTransition?: StartViewTransitionFn;
};

const useScrollDirection = (
    options: UseScrollDirectionOptions = {}
): ScrollDirection => {
    const {
        threshold = 50,
        minStateDurationMs = 300,
        pauseDuringViewTransition = true,
        resetKey
    } = options;
    const [direction, setDirection] = useState<ScrollDirection>("idle");
    /*
     * Mutable refs (not state) so the scroll handler's bookkeeping
     * doesn't retrigger the effect's setup/teardown on every event.
     * The hook resets these on mount and never reads them outside the
     * scroll handler, so React's render cycle never sees them.
     */
    const lastYRef = useRef<number>(0);
    const accumRef = useRef<number>(0);
    const lastFlipAtRef = useRef<number>(0);
    const inFlightTransitionsRef = useRef<number>(0);

    useEffect(() => {
        if (!isBrowser()) return;
        lastYRef.current = readScrollY();
        accumRef.current = 0;
        lastFlipAtRef.current = 0;
        // A change to any dep (notably `resetKey` on navigation) starts
        // a fresh measurement window, so the direction must not carry
        // over from the previous page / configuration.
        setDirection("idle");

        const handler = () => {
            // Pause direction updates during route view transitions.
            // The minimize-on-scroll transform would otherwise snapshot
            // mid-animation, which the browser then morphs into the
            // post-route snapshot, producing a flicker on restore.
            if (
                pauseDuringViewTransition &&
                inFlightTransitionsRef.current > 0
            ) {
                // Keep the lastY in sync so the next post-transition
                // scroll measures from the current position, not the
                // stale pre-transition one.
                lastYRef.current = readScrollY();
                accumRef.current = 0;
                return;
            }
            const y = readScrollY();
            // Top-of-page force-restore: at scrollY <= 0 there is no
            // content above to "scroll up" past the threshold, so a
            // latched "down" would strand the minimized state. Bypass
            // both the threshold and the lockout.
            if (y <= 0) {
                lastYRef.current = y;
                accumRef.current = 0;
                lastFlipAtRef.current = 0;
                setDirection((prev) => (prev === "idle" ? prev : "idle"));
                return;
            }
            const delta = y - lastYRef.current;
            lastYRef.current = y;
            if (delta === 0) return;
            /*
             * Accumulate in the current direction. A direction change
             * resets the accumulator so the next flip needs a fresh
             * `threshold` worth of motion. Without the reset, a user
             * who scrolled 50 px down then 1 px up would still trip
             * the up-flip via the residual accumulator.
             */
            if (
                (delta > 0 && accumRef.current < 0) ||
                (delta < 0 && accumRef.current > 0)
            ) {
                accumRef.current = delta;
            } else {
                accumRef.current += delta;
            }
            // Below threshold → no flip yet (hysteresis).
            if (Math.abs(accumRef.current) < threshold) return;
            const now = Date.now();
            // Min-duration lockout — a flip too soon after the last
            // flip is dropped (debounce on the direction itself, not
            // on individual scroll events).
            if (now - lastFlipAtRef.current < minStateDurationMs) return;
            const next: ScrollDirection = accumRef.current > 0 ? "down" : "up";
            // Only set + lockout if the direction actually changes.
            setDirection((prev) => {
                if (prev === next) return prev;
                lastFlipAtRef.current = now;
                accumRef.current = 0;
                return next;
            });
        };

        window.addEventListener("scroll", handler, { passive: true });

        /*
         * View-transition interception. We monkey-patch
         * `document.startViewTransition` to bump / decrement an
         * in-flight counter so the scroll handler can pause itself
         * during the transition. The original function is preserved
         * and called through; the wrapper just adds the bookkeeping.
         *
         * Counter-not-boolean: two concurrent transitions (rare but
         * possible — a navigation triggered during another navigation)
         * shouldn't unlock the gate when the first finishes.
         */
        const doc = document as unknown as DocumentWithViewTransition;
        const originalStart = doc.startViewTransition;
        if (pauseDuringViewTransition && typeof originalStart === "function") {
            const wrapped: StartViewTransitionFn = (...args: unknown[]) => {
                inFlightTransitionsRef.current += 1;
                const transition = originalStart.apply(doc, args) as {
                    finished?: Promise<unknown>;
                };
                const release = () => {
                    inFlightTransitionsRef.current = Math.max(
                        0,
                        inFlightTransitionsRef.current - 1
                    );
                };
                // Chromium's transition.finished is a Promise that
                // settles when the animation pair concludes. If
                // missing (test mock / older impl), fall back to a
                // microtask release so the gate doesn't latch
                // permanently on a hostile mock.
                if (transition?.finished?.then) {
                    transition.finished.then(release, release);
                } else {
                    Promise.resolve().then(release);
                }
                return transition;
            };
            doc.startViewTransition = wrapped;
        }

        return () => {
            window.removeEventListener("scroll", handler);
            if (
                pauseDuringViewTransition &&
                typeof originalStart === "function"
            ) {
                doc.startViewTransition = originalStart;
            }
        };
    }, [threshold, minStateDurationMs, pauseDuringViewTransition, resetKey]);

    return direction;
};

export default useScrollDirection;
