import { useCallback } from "react";

/**
 * useHaptic — Phase 6 Wave 2 T7.
 *
 * iOS 26's gel-flex motion is paired with subtle haptic feedback on
 * press. On the web we wire `navigator.vibrate` (Android Chrome ships;
 * iOS Safari does not, and feature-detect is the supported path —
 * Apple has shipped no equivalent API to date).
 *
 * Patterns mirror the four-stop "feedback" family the orchestration
 * brief specifies — the same names CarPlay / WatchOS expose via
 * `UIImpactFeedbackGenerator`:
 *
 *   - `tap`     → 10 ms                : a quick single bump (button press).
 *   - `success` → [10, 40, 20]         : short-pause-short, the
 *                                       "confirmation" pattern.
 *   - `warning` → [40, 40]             : medium-medium, the "caution"
 *                                       pattern.
 *   - `error`   → [40, 40, 40]         : medium-medium-medium, the
 *                                       "destructive failure" pattern.
 *
 * Crucially this hook is NOT gated on `prefers-reduced-motion`. The
 * orchestration brief treats haptics as a SEPARATE accessibility
 * category from motion — a screen-reader user who has motion off may
 * still want their phone to confirm "yes, the button registered". A
 * future user preference (`hapticsEnabled`) will gate this hook from
 * the settings UI; until then we hard-code `true` (TODO: Wave 5 work
 * adds the settings field).
 */

export type HapticPattern = "tap" | "success" | "warning" | "error";

/*
 * Pattern → vibration sequence (ms). Numbers and arrays both round-trip
 * through `navigator.vibrate` — a number is a single pulse, an array
 * alternates vibrate / pause / vibrate. Keeping the table exported so
 * tests can assert exact mappings without re-deriving them.
 */
export const HAPTIC_PATTERNS: Record<HapticPattern, number | number[]> = {
    tap: 10,
    success: [10, 40, 20],
    warning: [40, 40],
    error: [40, 40, 40]
};

interface HapticApi {
    /**
     * Trigger the named vibration pattern. No-op when the device /
     * browser doesn't expose `navigator.vibrate` (iOS Safari today)
     * or when the user has opted out via the future
     * `hapticsEnabled` preference.
     */
    vibrate: (pattern: HapticPattern) => void;
}

/*
 * Feature detection split out so tests can mock `navigator.vibrate`
 * onto a JSDOM-resolved `navigator` and re-evaluate the predicate.
 * The check has to be re-evaluated per call, not at module init,
 * because the test harness can swap the mock between calls (and
 * JSDOM doesn't ship `vibrate` natively — the test installs it).
 */
const supportsVibrate = (): boolean =>
    typeof navigator !== "undefined" &&
    "vibrate" in navigator &&
    typeof navigator.vibrate === "function";

/**
 * Feature-detected vibration hook. Returns a stable `{ vibrate }`
 * object the caller can attach to any tap / press / activate handler.
 * The returned function is wrapped in `useCallback` so consumers can
 * pass it into a dependency array without retriggering effects.
 */
const useHaptic = (): HapticApi => {
    /*
     * TODO (Wave 5): replace this hard-coded `true` with
     * `useReduxSelector((s) => s.userPreferences.hapticsEnabled ?? true)`
     * once a settings UI is wired. The hard-code keeps Wave 2 isolated
     * from Worker A's `userPreferencesSlice` edits — adding the field
     * here would risk a merge conflict with the parallel slice work.
     * Default remains `true` so haptics ship enabled-by-default per the
     * orchestration brief.
     */
    const hapticsEnabled = true;

    const vibrate = useCallback(
        (pattern: HapticPattern) => {
            if (!hapticsEnabled) return;
            if (!supportsVibrate()) return;
            const value = HAPTIC_PATTERNS[pattern];
            try {
                /*
                 * `vibrate` returns `false` when the browser silently
                 * declined (no user gesture preceded the call, or a
                 * permission policy is in effect). We don't surface
                 * that — the haptic is best-effort fire-and-forget,
                 * and a return value plumbed up to callers would be
                 * misleading on iOS Safari (where `vibrate` doesn't
                 * exist at all and the no-op path skips this branch
                 * entirely).
                 */
                navigator.vibrate(value);
            } catch {
                // Silently swallow — a misbehaving native impl that
                // throws on certain payload shapes should never bring
                // down the surrounding UI handler.
            }
        },
        [hapticsEnabled]
    );

    return { vibrate };
};

export default useHaptic;
