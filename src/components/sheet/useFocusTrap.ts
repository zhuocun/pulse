import { useEffect, type RefObject } from "react";

/**
 * Cycles Tab / Shift-Tab focus between the first and last focusable
 * descendants of `containerRef.current` while `active` is true, and
 * restores focus to the previously-active element on unmount.
 *
 * Used by the Sheet primitive's animated branch. The reduced-motion
 * and desktop fallbacks defer to AntD `<Drawer>`, which carries its
 * own trap, so this helper is only invoked when the custom surface
 * mounts.
 *
 * Inspired by the WAI-ARIA dialog pattern: when an overlay opens,
 * focus moves into the surface; when it closes, focus moves back to
 * the trigger so keyboard users return to a sensible spot.
 *
 * The implementation deliberately avoids a third-party dep so the
 * Sheet surface stays a thin primitive over Framer Motion + a small
 * a11y hook.
 */
const FOCUSABLE_SELECTOR = [
    "a[href]",
    "area[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "iframe",
    "object",
    "embed",
    "[contenteditable='true']",
    "[tabindex]:not([tabindex='-1'])"
].join(",");

const collectFocusable = (root: HTMLElement): HTMLElement[] => {
    const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );
    return nodes.filter((node) => {
        if (node.hidden) return false;
        // `tabindex="-1"` is excluded by the selector; we still want to
        // skip elements made unreachable by `aria-hidden` on an ancestor.
        const style = window.getComputedStyle(node);
        return style.visibility !== "hidden" && style.display !== "none";
    });
};

interface UseFocusTrapOptions {
    /**
     * Optional pre-resolved element to focus on activation. Defaults to
     * the first focusable descendant of `containerRef.current`.
     */
    initialFocus?: HTMLElement | null;
}

const useFocusTrap = (
    containerRef: RefObject<HTMLElement | null>,
    active: boolean,
    options: UseFocusTrapOptions = {}
): void => {
    const { initialFocus } = options;
    useEffect(() => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;

        const previouslyFocused = (
            typeof document !== "undefined" ? document.activeElement : null
        ) as HTMLElement | null;

        // Move focus into the container on activation. We use a
        // microtask so portal'd content has a tick to mount its
        // focusable nodes before we query them.
        const focusInitial = () => {
            const target =
                initialFocus ?? collectFocusable(container)[0] ?? container;
            if (target && typeof target.focus === "function") {
                target.focus({ preventScroll: true });
            }
        };
        // RAF instead of microtask so Framer Motion's mount animation
        // settles before we steal focus — avoids the visible flash of
        // the focus ring landing mid-translate.
        const raf = window.requestAnimationFrame(focusInitial);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const focusables = collectFocusable(container);
            if (focusables.length === 0) {
                // Nothing to focus inside — keep focus on the container.
                event.preventDefault();
                container.focus({ preventScroll: true });
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const activeEl = document.activeElement as HTMLElement | null;
            if (event.shiftKey) {
                if (activeEl === first || !container.contains(activeEl)) {
                    event.preventDefault();
                    last.focus({ preventScroll: true });
                }
                return;
            }
            if (activeEl === last || !container.contains(activeEl)) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            window.cancelAnimationFrame(raf);
            document.removeEventListener("keydown", handleKeyDown);
            // Restore focus to the previously-active element. Guard
            // against detached nodes (test cleanup, virtual scroll).
            if (
                previouslyFocused &&
                typeof previouslyFocused.focus === "function" &&
                document.contains(previouslyFocused)
            ) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, [active, containerRef, initialFocus]);
};

export default useFocusTrap;
