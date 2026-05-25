import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import SuccessSparkle from ".";

expect.extend(toHaveNoViolations);

/**
 * Swap `window.matchMedia` so `useReducedMotion` resolves to the requested
 * state on the very first render (the hook seeds its state from a
 * `matchMedia(...).matches` read). Returns a restore fn so other suites in
 * the same process aren't observed through the mock — the established
 * pattern (`sheet`, `bottomTabBar`).
 */
const setReducedMotion = (reduced: boolean): (() => void) => {
    const previous = window.matchMedia;
    (window as { matchMedia: typeof window.matchMedia }).matchMedia = ((
        query: string
    ) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    })) as unknown as typeof window.matchMedia;
    return () => {
        (window as { matchMedia: typeof window.matchMedia }).matchMedia =
            previous;
    };
};

describe("SuccessSparkle", () => {
    let restoreMatchMedia: () => void;

    afterEach(() => {
        restoreMatchMedia?.();
    });

    it("renders the decorative particle burst when motion is enabled", () => {
        restoreMatchMedia = setReducedMotion(false);
        render(<SuccessSparkle data-testid="sparkle" />);
        const overlay = screen.getByTestId("sparkle");
        expect(overlay).toBeInTheDocument();
        // Decorative only — hidden from the AX tree and not focusable.
        expect(overlay).toHaveAttribute("aria-hidden", "true");
        // A handful of particle dots burst out of the overlay.
        expect(overlay.children.length).toBe(8);
    });

    it("renders NOTHING under prefers-reduced-motion (no movement, no static remnant)", () => {
        restoreMatchMedia = setReducedMotion(true);
        const { container } = render(<SuccessSparkle data-testid="sparkle" />);
        expect(screen.queryByTestId("sparkle")).not.toBeInTheDocument();
        // The component returns null outright — nothing painted at all.
        expect(container).toBeEmptyDOMElement();
    });

    it("has no axe-detectable a11y violations (decorative aria-hidden overlay)", async () => {
        restoreMatchMedia = setReducedMotion(false);
        const { container } = render(<SuccessSparkle data-testid="sparkle" />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
