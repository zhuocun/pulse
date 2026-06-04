import { useCallback, useEffect, useState } from "react";

/**
 * Phase 4.4 — first-login onboarding tour state.
 *
 * The tour is a one-shot, non-blocking nicety: it auto-opens once on the
 * very first authenticated visit, then a `localStorage` flag suppresses it
 * forever after. The flag uses the same defensive `try/catch` idiom the
 * rest of the repo's storage hooks use (see `userPreferencesSlice`'s
 * `persistUserPreferences`) so a locked-down / private-browsing
 * `localStorage` never throws into render or wedges the boot path.
 *
 * The hook is intentionally storage-only: it does NOT know about auth or
 * route gating. The mount site (`MainLayout`) composes those predicates so
 * the hook stays a pure persistence primitive that is trivial to test.
 */
export const ONBOARDING_DISMISSED_KEY = "pulse:onboarding:dismissed";

/**
 * Reads the dismissed flag defensively. Any failure (no `window`,
 * `localStorage` access denied) reads as "dismissed" so we err on the
 * side of NOT nagging the user — a first-login nicety should never become
 * a recurring annoyance just because storage is flaky.
 */
const readDismissed = (): boolean => {
    if (typeof window === "undefined") return true;
    try {
        return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true";
    } catch {
        return true;
    }
};

/**
 * Persists the dismissed flag. Best-effort — a `QuotaExceededError`
 * (Safari private mode) is swallowed; the in-memory `open` flag still
 * flips so the tour closes for the current session regardless.
 */
const writeDismissed = (): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
    } catch {
        // Persistence is best-effort; closing the tour in-session is the
        // contract that matters for the current page view.
    }
};

export interface UseOnboardingTourResult {
    /** Whether the tour should currently be shown. */
    open: boolean;
    /** Mark the tour dismissed (persisted) and close it. */
    dismiss: () => void;
    /** Re-open the tour without clearing the dismissed flag (optional CTA). */
    reopen: () => void;
}

/**
 * Drives the onboarding tour's open/dismissed lifecycle.
 *
 * @param eligible - the composed gate from the mount site: `true` only
 *   when the user is authenticated and not on an auth page. The tour
 *   auto-opens once when `eligible` becomes true AND the dismissed flag is
 *   unset. Passing `false` keeps it closed without touching storage, so
 *   logging out / landing on `/login` never auto-shows it.
 */
const useOnboardingTour = (eligible: boolean): UseOnboardingTourResult => {
    // Seed from storage once; subsequent dismiss flips this in-memory.
    const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
    const [open, setOpen] = useState<boolean>(false);

    useEffect(() => {
        // Auto-open exactly once: eligible, not dismissed, not already open.
        if (eligible && !dismissed) {
            setOpen(true);
        }
    }, [eligible, dismissed]);

    const dismiss = useCallback(() => {
        writeDismissed();
        setDismissed(true);
        setOpen(false);
    }, []);

    const reopen = useCallback(() => {
        setOpen(true);
    }, []);

    return { open, dismiss, reopen };
};

export default useOnboardingTour;
