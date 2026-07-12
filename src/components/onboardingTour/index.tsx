import { X } from "lucide-react";
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import useAuth from "../../utils/hooks/useAuth";
import useOnboardingTour from "../../utils/hooks/useOnboardingTour";

/**
 * Phase 4.4 — first-login product tour.
 *
 * A lightweight, one-shot coachmark that introduces the primary
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
 *  - Each `target` is a `() => HTMLElement | null` resolver. A step whose
 *    element is not mounted on the current route degrades gracefully to a
 *    centered card (no anchor) rather than throwing.
 *  - Under `prefers-reduced-motion: reduce` the enter animation is
 *    disabled via `motion-safe:` variants (the CSS media query the
 *    tailwindcss-animate utilities key off).
 *  - It must never trap focus permanently: closing, finishing, pressing
 *    Esc, or clicking the mask all route through `dismiss`, which persists
 *    the flag and closes the tour.
 */

/** Auth routes never host the tour — keep it out of login / signup pages. */
const AUTH_ROUTE_PREFIXES = ["/login", "/signup", "/register", "/auth"];

const isAuthRoute = (pathname: string): boolean =>
    AUTH_ROUTE_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );

type TargetResolver = () => HTMLElement | null;

interface TourStep {
    title: string;
    description: string;
    /** Resolves the anchor element, or `null` for a centered card. */
    target: TargetResolver | null;
}

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

interface AnchorRect {
    top: number;
    left: number;
    bottom: number;
    width: number;
    height: number;
}

const OnboardingTour: React.FC = () => {
    const { isAuthenticated } = useAuth();
    const { pathname } = useLocation();
    // Eligible only when authenticated AND inside the authenticated shell
    // (never on an auth page). The hook owns the "shown once" persistence.
    const eligible = isAuthenticated && !isAuthRoute(pathname);
    const { open, dismiss } = useOnboardingTour(eligible);

    const [stepIndex, setStepIndex] = useState(0);
    const [anchor, setAnchor] = useState<AnchorRect | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const descId = useId();

    const steps = useMemo<TourStep[]>(
        () => [
            {
                title: microcopy.onboardingTour.welcome.title,
                description: microcopy.onboardingTour.welcome.description,
                // Welcome is intentionally a centered card (null target).
                target: null
            },
            {
                title: microcopy.onboardingTour.navigation.title,
                description: microcopy.onboardingTour.navigation.description,
                target: findPrimaryNavTarget
            },
            {
                title: microcopy.onboardingTour.copilot.title,
                description: microcopy.onboardingTour.copilot.description,
                // Copilot lives in the account menu / dock; anchor it to
                // the account trigger when present, else centered.
                target: findAccountTarget
            },
            {
                title: microcopy.onboardingTour.account.title,
                description: microcopy.onboardingTour.account.description,
                target: findBrandTarget
            }
        ],
        []
    );

    // Snap back to the first step whenever the tour (re)opens.
    useEffect(() => {
        if (open) setStepIndex(0);
    }, [open]);

    // Resolve the current step's anchor rect. A zero-size / absent element
    // resolves to `null`, which renders the card centered.
    useEffect(() => {
        if (!open) return;
        const resolver = steps[stepIndex]?.target;
        const el = resolver ? resolver() : null;
        const rect = el?.getBoundingClientRect();
        setAnchor(
            rect && (rect.width > 0 || rect.height > 0)
                ? {
                      top: rect.top,
                      left: rect.left,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height
                  }
                : null
        );
    }, [open, stepIndex, steps]);

    // Esc closes the tour (never traps focus).
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                dismiss();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, dismiss]);

    // Move focus into the card so keyboard users land inside the tour.
    useEffect(() => {
        if (open) cardRef.current?.focus();
    }, [open, stepIndex]);

    const isLast = stepIndex === steps.length - 1;
    const handleNext = useCallback(() => {
        if (isLast) {
            dismiss();
            return;
        }
        setStepIndex((index) => index + 1);
    }, [dismiss, isLast]);
    const handlePrev = useCallback(() => {
        setStepIndex((index) => Math.max(0, index - 1));
    }, []);

    const step = steps[stepIndex];

    // Gate rendering entirely so the component is a true no-op when the
    // user is unauthenticated, on an auth page, or has dismissed the tour.
    if (!eligible || !open || !step || typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div>
            {anchor ? (
                // Spotlight cutout: a box at the anchor rect whose huge
                // outer box-shadow dims the rest of the screen.
                <div
                    aria-hidden
                    className="fixed z-[1070] rounded-md shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
                    onClick={dismiss}
                    role="presentation"
                    style={{
                        top: anchor.top - 4,
                        left: anchor.left - 4,
                        width: anchor.width + 8,
                        height: anchor.height + 8
                    }}
                />
            ) : (
                <div
                    className="fixed inset-0 z-[1070] bg-black/45"
                    onClick={dismiss}
                    role="presentation"
                />
            )}
            <div
                aria-describedby={descId}
                aria-labelledby={titleId}
                aria-modal="true"
                className={cn(
                    "fixed z-[1071] w-[320px] max-w-[calc(100vw-32px)] rounded-lg border border-border",
                    "bg-card p-lg text-card-foreground shadow-lg",
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
                    anchor
                        ? ""
                        : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                )}
                ref={cardRef}
                role="dialog"
                style={
                    anchor
                        ? {
                              top: anchor.bottom + 12,
                              left: Math.max(16, anchor.left)
                          }
                        : undefined
                }
                tabIndex={-1}
            >
                <button
                    aria-label={microcopy.actions.close}
                    className="absolute right-md top-md inline-flex items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={dismiss}
                    type="button"
                >
                    <X aria-hidden className="size-4" />
                </button>
                <h2
                    className="pr-lg text-lg font-semibold leading-none tracking-tight text-foreground"
                    id={titleId}
                >
                    {step.title}
                </h2>
                <p className="mt-xs text-sm text-muted-foreground" id={descId}>
                    {step.description}
                </p>
                <div className="mt-md flex items-center justify-end gap-xs">
                    {stepIndex > 0 ? (
                        <Button onClick={handlePrev} size="sm" variant="ghost">
                            {microcopy.onboardingTour.previous}
                        </Button>
                    ) : null}
                    <Button onClick={handleNext} size="sm" variant="primary">
                        {isLast
                            ? microcopy.onboardingTour.done
                            : microcopy.onboardingTour.next}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default OnboardingTour;
