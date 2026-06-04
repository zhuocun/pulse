import { Tour, type TourProps, type TourStepProps } from "antd";
import { useMemo } from "react";
import { useLocation } from "react-router";

import { microcopy } from "../../constants/microcopy";
import useAuth from "../../utils/hooks/useAuth";
import useOnboardingTour from "../../utils/hooks/useOnboardingTour";

/**
 * Phase 4.4 — first-login product tour.
 *
 * A lightweight, one-shot AntD `<Tour>` that introduces the primary
 * navigation, Board Copilot, and the account menu on the first
 * authenticated visit, then never auto-shows again (the dismissed flag
 * lives in `localStorage` via `useOnboardingTour`).
 *
 * Design constraints that shape this component:
 *
 *  - It targets EXISTING DOM nodes via `document.querySelector` lookups
 *    (stable accessible names / nav landmark) so it never has to reach
 *    into the header / bottom-bar components to add refs — those are
 *    owned by other workstreams.
 *  - Each `target` is a `() => HTMLElement | null` resolver. AntD's Tour
 *    treats a `null` target as a CENTERED step (no anchor, no crash), so
 *    a step whose element is not mounted on the current route degrades
 *    gracefully to a centered card rather than throwing.
 *  - Under `prefers-reduced-motion: reduce` we pass `animated={false}` so
 *    the spotlight / placeholder transitions are disabled.
 *  - It must never trap focus permanently: closing, finishing, pressing
 *    Esc (Tour `keyboard`), or clicking the mask all route through
 *    `dismiss`, which persists the flag and closes the tour.
 */

/** Auth routes never host the tour — keep it out of login / signup pages. */
const AUTH_ROUTE_PREFIXES = ["/login", "/signup", "/register", "/auth"];

const isAuthRoute = (pathname: string): boolean =>
    AUTH_ROUTE_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );

/**
 * AntD's `TourStepProps["target"]` accepts `() => HTMLElement` OR
 * `() => null` (a discriminated union), NOT a single
 * `() => HTMLElement | null`. Our resolvers genuinely return either —
 * the element when mounted, `null` when absent (graceful centered-step
 * degradation). This alias lets us declare the resolvers honestly and
 * hand them to a step `target` without a per-call-site cast; AntD's
 * runtime already null-checks the result.
 */
type TargetResolver = () => HTMLElement | null;

/**
 * Resolves the brand-home link in the header. Present on every route.
 */
const findBrandTarget: TargetResolver = () => {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(
        `[aria-label="${microcopy.header.logoLabel}"]`
    );
};

/**
 * Resolves the primary navigation landmark. Two landmarks can carry it
 * depending on chrome: the desktop header nav (`aria-label` =
 * `nav.desktopNavLabel`) on fine-pointer surfaces, and the bottom tab bar
 * (`aria-label` = `nav.primaryLandmarkLabel`) on phone chrome. We try
 * whichever is mounted, so the navigation step spotlights a real element
 * on both surfaces; if neither is present the step degrades to a centered
 * card.
 */
const findPrimaryNavTarget: TargetResolver = () => {
    if (typeof document === "undefined") return null;
    return (
        document.querySelector<HTMLElement>(
            `nav[aria-label="${microcopy.nav.desktopNavLabel}"]`
        ) ??
        document.querySelector<HTMLElement>(
            `nav[aria-label="${microcopy.nav.primaryLandmarkLabel}"]`
        )
    );
};

/**
 * Resolves the account-menu trigger in the header. Its accessible name is
 * "Account menu for {name}", so we match on the stable prefix rather than
 * the interpolated username. Demoted (hidden) on phone chrome, where this
 * step degrades to a centered card.
 */
const findAccountTarget: TargetResolver = () => {
    if (typeof document === "undefined") return null;
    const prefix = microcopy.a11y.accountMenuFor.split("{name}")[0]?.trim();
    if (!prefix) return null;
    const candidates = document.querySelectorAll<HTMLElement>("[aria-label]");
    for (const el of Array.from(candidates)) {
        if (el.getAttribute("aria-label")?.startsWith(prefix)) return el;
    }
    return null;
};

/**
 * Wraps a `TargetResolver` so it satisfies AntD's `target` union. The
 * resolver may return `null` (absent element → centered step); we cast
 * because AntD types the prop as `(() => HTMLElement) | (() => null)`
 * rather than `() => HTMLElement | null`, but accepts a null result at
 * runtime all the same.
 */
const asTarget = (resolver: TargetResolver): TourStepProps["target"] =>
    resolver as TourStepProps["target"];

/**
 * Reads the user's reduced-motion preference once at render. Defensive
 * around `matchMedia` (jsdom / SSR) — defaults to "motion allowed".
 */
const prefersReducedMotion = (): boolean => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
};

const OnboardingTour: React.FC = () => {
    const { isAuthenticated } = useAuth();
    const { pathname } = useLocation();
    // Eligible only when authenticated AND inside the authenticated shell
    // (never on an auth page). The hook owns the "shown once" persistence.
    const eligible = isAuthenticated && !isAuthRoute(pathname);
    const { open, dismiss } = useOnboardingTour(eligible);

    const reducedMotion = prefersReducedMotion();

    const steps = useMemo<TourProps["steps"]>(() => {
        // Localized Next / Back button labels, applied per-step (AntD Tour
        // exposes the button overrides on each step, not at the root). The
        // final step's primary button auto-reads "Finish"; we override its
        // label to the localized "Done" microcopy.
        const next = { children: microcopy.onboardingTour.next };
        const prev = { children: microcopy.onboardingTour.previous };
        const done = { children: microcopy.onboardingTour.done };
        return [
            {
                title: microcopy.onboardingTour.welcome.title,
                description: microcopy.onboardingTour.welcome.description,
                // Welcome is intentionally a centered card (null target).
                target: null,
                nextButtonProps: next
            },
            {
                title: microcopy.onboardingTour.navigation.title,
                description: microcopy.onboardingTour.navigation.description,
                target: asTarget(findPrimaryNavTarget),
                nextButtonProps: next,
                prevButtonProps: prev
            },
            {
                title: microcopy.onboardingTour.copilot.title,
                description: microcopy.onboardingTour.copilot.description,
                // Copilot lives in the account menu / dock; anchor it to
                // the account trigger when present, else centered.
                target: asTarget(findAccountTarget),
                nextButtonProps: next,
                prevButtonProps: prev
            },
            {
                title: microcopy.onboardingTour.account.title,
                description: microcopy.onboardingTour.account.description,
                target: asTarget(findBrandTarget),
                nextButtonProps: done,
                prevButtonProps: prev
            }
        ];
    }, []);

    // Gate rendering entirely so the component is a true no-op when the
    // user is unauthenticated, on an auth page, or has dismissed the tour.
    if (!eligible || !open) return null;

    return (
        <Tour
            animated={!reducedMotion}
            open={open}
            onClose={dismiss}
            onFinish={dismiss}
            steps={steps}
            // Esc closes the tour (never traps focus); the close routes
            // through `dismiss` via onClose.
            keyboard
        />
    );
};

export default OnboardingTour;
