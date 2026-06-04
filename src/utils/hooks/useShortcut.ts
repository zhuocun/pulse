import { useEffect, useRef } from "react";

import type { ShortcutSegment } from "../../constants/shortcuts";
import { isMacLike } from "../platform";

/**
 * `useShortcut` binds a structured catalog combo (from
 * `src/constants/shortcuts.ts`) to a handler so the documented keystroke and
 * the wired-up behavior cannot drift.
 *
 * Supported combos:
 *   - single chord: one segment of tokens pressed together (e.g. `Cmd+K`,
 *     `?`). Any one token in the segment matching the event satisfies a
 *     single-token chord; multi-token single segments require the modifier
 *     plus the key.
 *   - typed sequence: multiple segments pressed in turn within a short
 *     timeout (e.g. `g` then `p`). Each segment is a single key.
 *
 * It respects an `enabled` flag and ignores events that originate from text
 * inputs / textareas / contentEditable so e.g. `?` doesn't fire while the
 * user is typing. Listeners are cleaned up on unmount / dep change.
 */

const SEQUENCE_TIMEOUT_MS = 1000;

interface UseShortcutOptions {
    /** When false, the listener is not installed. Defaults to true. */
    enabled?: boolean;
    /** Call `preventDefault()` when the combo fires. Defaults to true. */
    preventDefault?: boolean;
}

/** True when the event target is an editable field we should not hijack. */
const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
    }
    if (target.isContentEditable) return true;
    return false;
};

/** Match a single key value against an event, case-insensitively. */
const keyMatches = (eventKey: string, tokenKey: string): boolean =>
    eventKey.toLowerCase() === tokenKey.toLowerCase();

/**
 * Does this single-segment chord match the event? A token matches when its
 * key equals the event key AND (if `mod` is set) the platform command
 * modifier is held. For multi-token segments (e.g. the keyboard-drag hint
 * combo) ANY token matching is enough — it's documentation-only.
 */
const chordMatches = (
    segment: ShortcutSegment,
    event: KeyboardEvent
): boolean => {
    const modHeld = isMacLike() ? event.metaKey : event.ctrlKey;
    return segment.some((token) => {
        if (!keyMatches(event.key, token.key)) return false;
        if (token.mod) return modHeld;
        // A non-mod token must NOT be accompanied by the command modifier so
        // `c` doesn't fire on `Cmd+C` (copy).
        return !modHeld;
    });
};

const useShortcut = (
    combo: readonly ShortcutSegment[],
    handler: () => void,
    opts: UseShortcutOptions = {}
): void => {
    const { enabled = true, preventDefault = true } = opts;
    // Keep the latest handler in a ref so re-renders don't re-bind listeners
    // (and the chord-sequence timer survives handler identity churn).
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === "undefined") return;

        const isSequence = combo.length > 1;

        // Single-chord path.
        if (!isSequence) {
            const onKey = (event: KeyboardEvent) => {
                if (isEditableTarget(event.target)) return;
                if (chordMatches(combo[0], event)) {
                    if (preventDefault) event.preventDefault();
                    handlerRef.current();
                }
            };
            window.addEventListener("keydown", onKey);
            return () => window.removeEventListener("keydown", onKey);
        }

        // Typed-sequence path (e.g. `g p`). We track how many leading
        // segments have matched so far; a non-matching key (or timeout)
        // resets progress. Each segment is treated as a single key.
        let progress = 0;
        let timer: number | undefined;

        const reset = () => {
            progress = 0;
            if (timer !== undefined) {
                window.clearTimeout(timer);
                timer = undefined;
            }
        };

        const onKey = (event: KeyboardEvent) => {
            if (isEditableTarget(event.target)) return;
            // Modifier-key presses (holding Cmd etc.) shouldn't break or
            // advance a plain-letter sequence; ignore standalone modifiers.
            if (event.metaKey || event.ctrlKey || event.altKey) {
                reset();
                return;
            }
            const expected = combo[progress];
            const matches = expected.some((token) =>
                keyMatches(event.key, token.key)
            );
            if (!matches) {
                // Restart: maybe this key begins the sequence afresh.
                reset();
                if (
                    combo[0].some((token) => keyMatches(event.key, token.key))
                ) {
                    progress = 1;
                    timer = window.setTimeout(reset, SEQUENCE_TIMEOUT_MS);
                }
                return;
            }
            progress += 1;
            if (timer !== undefined) window.clearTimeout(timer);
            if (progress >= combo.length) {
                reset();
                if (preventDefault) event.preventDefault();
                handlerRef.current();
                return;
            }
            timer = window.setTimeout(reset, SEQUENCE_TIMEOUT_MS);
        };

        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            reset();
        };
    }, [combo, enabled, preventDefault]);
};

export default useShortcut;
