import { useEffect, useState } from "react";

/**
 * Phase 6 Wave 1 — `useKeyboardOpen` is the single source of truth for
 * "is the soft keyboard currently raised over the viewport". Extracted
 * from the inline detection block at `bottomTabBar/index.tsx` so the
 * Wave 3 Sheet primitive (which needs to clamp its detents above the
 * keyboard) can share the same predicate.
 *
 * Detection logic:
 *
 *   1. Subscribe to `window.visualViewport.resize` AND `scroll`. The
 *      `scroll` listener catches Chrome Android's keyboard-related
 *      viewport delta which is emitted on scroll rather than resize.
 *   2. ALSO subscribe to `document.focusin` / `focusout` so the input-
 *      focused gate is re-evaluated when focus moves between fields
 *      (the visualViewport event handler alone wouldn't fire on a
 *      pure focus change with no viewport delta — common when the
 *      user taps from one field to another while the keyboard stays
 *      up).
 *   3. Treat the keyboard as open ONLY when BOTH
 *      `visualViewport.height < window.innerHeight * 0.75` AND a text
 *      input is focused (`HTMLInputElement` or `HTMLTextAreaElement`
 *      — `contenteditable` ranges are deliberately out of scope; if a
 *      future surface needs them, extend the predicate here so every
 *      consumer benefits in one shot).
 *
 * The 0.75 ratio threshold tolerates Chrome Android's URL-bar collapse
 * (~56–100 px) without false-firing, and the activeElement gate keeps
 * us from treating a scroll-driven viewport shrink as a keyboard
 * event. A graceful fallback returns `false` when `visualViewport` is
 * undefined (Safari iOS &lt; 14, jsdom, SSR).
 *
 * SSR-safe: returns `false` when `typeof window === "undefined"`.
 *
 * Consumers (the single source of truth contract):
 *   - `bottomTabBar/index.tsx` — drives the `$hidden` translate-out
 *     transform on the Nav (the existing behaviour, refactored out of
 *     the inline `useEffect` block).
 *   - Wave 3 Sheet primitive will consume the same hook to clamp its
 *     detents above the keyboard rather than fighting it for screen
 *     real estate.
 */

const KEYBOARD_HEIGHT_RATIO = 0.75;

const isBrowser = (): boolean => typeof window !== "undefined";

const computeOpen = (): boolean => {
    if (!isBrowser()) return false;
    const vv = window.visualViewport;
    if (!vv) return false;
    const active =
        typeof document !== "undefined" ? document.activeElement : null;
    const inputFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement;
    const shrunk = vv.height < window.innerHeight * KEYBOARD_HEIGHT_RATIO;
    return inputFocused && shrunk;
};

const useKeyboardOpen = (): boolean => {
    const [open, setOpen] = useState<boolean>(() => computeOpen());

    useEffect(() => {
        if (!isBrowser()) return;
        const vv = window.visualViewport;
        // SSR / Safari iOS < 14 / jsdom: no visualViewport API, so we
        // can't detect the keyboard. Keep the initial `false` value
        // and skip the subscriptions entirely.
        if (!vv) return;
        const handler = () => setOpen(computeOpen());
        // Re-run the predicate on every viewport delta AND on every
        // focus change. A focus change without a viewport delta (user
        // tapping between two fields while the keyboard stays up) is
        // a common case the visualViewport listener alone misses.
        vv.addEventListener("resize", handler);
        vv.addEventListener("scroll", handler);
        document.addEventListener("focusin", handler);
        document.addEventListener("focusout", handler);
        // Sync once after the listeners are attached so a late-mounted
        // hook (e.g. a Sheet that opened while the keyboard was
        // already up) picks up the current state.
        handler();
        return () => {
            vv.removeEventListener("resize", handler);
            vv.removeEventListener("scroll", handler);
            document.removeEventListener("focusin", handler);
            document.removeEventListener("focusout", handler);
        };
    }, []);

    return open;
};

export default useKeyboardOpen;
