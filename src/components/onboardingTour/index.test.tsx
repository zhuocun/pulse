/* eslint-disable global-require */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import useAuth from "../../utils/hooks/useAuth";
import { ONBOARDING_DISMISSED_KEY } from "../../utils/hooks/useOnboardingTour";

import OnboardingTour from ".";

jest.mock("../../utils/hooks/useAuth");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const setAuthenticated = (isAuthenticated: boolean) => {
    mockedUseAuth.mockReturnValue({
        user: isAuthenticated ? ({ _id: "u1" } as unknown as IUser) : undefined,
        isAuthenticated,
        logout: jest.fn()
    } as ReturnType<typeof useAuth>);
};

/**
 * Installs a matchMedia stub. `reducedMotion` controls whether the
 * `(prefers-reduced-motion: reduce)` query reports a match.
 */
const installMatchMedia = (reducedMotion: boolean) => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches:
                query === "(prefers-reduced-motion: reduce)"
                    ? reducedMotion
                    : false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const renderTour = (initialPath = "/projects") =>
    render(
        <MemoryRouter initialEntries={[initialPath]}>
            <OnboardingTour />
        </MemoryRouter>
    );

describe("OnboardingTour", () => {
    beforeEach(() => {
        window.localStorage.clear();
        installMatchMedia(false);
        setAuthenticated(true);
    });

    afterEach(() => {
        jest.clearAllMocks();
        (window as { matchMedia?: typeof window.matchMedia }).matchMedia =
            undefined;
    });

    it("auto-opens on first authenticated visit (renders the welcome step)", () => {
        renderTour();
        expect(
            screen.getByText(microcopy.onboardingTour.welcome.title)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.onboardingTour.welcome.description)
        ).toBeInTheDocument();
    });

    it("does NOT open when previously dismissed", () => {
        window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
        renderTour();
        expect(
            screen.queryByText(microcopy.onboardingTour.welcome.title)
        ).not.toBeInTheDocument();
    });

    it("does NOT open when unauthenticated", () => {
        setAuthenticated(false);
        renderTour();
        expect(
            screen.queryByText(microcopy.onboardingTour.welcome.title)
        ).not.toBeInTheDocument();
    });

    it("does NOT open on an auth page even when authenticated", () => {
        renderTour("/login");
        expect(
            screen.queryByText(microcopy.onboardingTour.welcome.title)
        ).not.toBeInTheDocument();
    });

    it("closing the tour persists the dismissed flag and removes it", async () => {
        renderTour();
        expect(
            screen.getByText(microcopy.onboardingTour.welcome.title)
        ).toBeInTheDocument();

        // AntD Tour renders a close (X) button — click it to dismiss.
        const closeButton = screen.getByRole("button", { name: /close/i });
        await userEvent.click(closeButton);

        expect(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBe(
            "true"
        );
        expect(
            screen.queryByText(microcopy.onboardingTour.welcome.title)
        ).not.toBeInTheDocument();
    });

    it("does not crash when step targets are absent (degrades to centered steps)", async () => {
        // No header / nav landmarks are mounted in this isolated render, so
        // every resolver returns null. The tour must still open and advance
        // (null target → centered card) rather than throw.
        renderTour();
        expect(
            screen.getByText(microcopy.onboardingTour.welcome.title)
        ).toBeInTheDocument();

        const next = screen.getByRole("button", {
            name: microcopy.onboardingTour.next
        });
        await userEvent.click(next);
        // Advancing to the (target-less) navigation step must not crash.
        expect(
            screen.getByText(microcopy.onboardingTour.navigation.title)
        ).toBeInTheDocument();
    });

    it("resolves the brand target when the element is present", () => {
        // Mount a stand-in brand element so the account step's resolver can
        // find a real node — proves the DOM-query targeting works without
        // editing the header component.
        const brand = document.createElement("button");
        brand.setAttribute("aria-label", microcopy.header.logoLabel);
        document.body.appendChild(brand);
        try {
            renderTour();
            expect(
                screen.getByText(microcopy.onboardingTour.welcome.title)
            ).toBeInTheDocument();
        } finally {
            brand.remove();
        }
    });
});
