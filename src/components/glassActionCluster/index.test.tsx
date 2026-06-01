import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    coarseTouchTargetsFor,
    styledClassFor
} from "../../testUtils/styleRules";

import GlassActionCluster from ".";

expect.extend(toHaveNoViolations);

/**
 * Install the canonical AntD browser mocks (matchMedia + ResizeObserver)
 * so styled-component media queries and any AntD child render without
 * throwing in jsdom. Returns a cleanup that restores the originals so
 * sibling suites in the same process aren't observed through the mocks.
 * `matchMedia` is writable; `ResizeObserver` is non-writable on
 * `globalThis`, so we go through `Object.defineProperty`.
 */
const installAntdBrowserMocks = (): (() => void) => {
    const previousMatchMedia = window.matchMedia;
    const previousResizeObserver = window.ResizeObserver;
    (window as { matchMedia: typeof window.matchMedia }).matchMedia = ((
        query: string
    ) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    })) as unknown as typeof window.matchMedia;
    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }
    Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: ResizeObserverMock
    });
    return () => {
        (window as { matchMedia: typeof window.matchMedia }).matchMedia =
            previousMatchMedia;
        Object.defineProperty(window, "ResizeObserver", {
            configurable: true,
            writable: true,
            value: previousResizeObserver
        });
    };
};

describe("GlassActionCluster", () => {
    let restoreMocks: () => void;

    beforeEach(() => {
        restoreMocks = installAntdBrowserMocks();
    });

    afterEach(() => {
        restoreMocks();
    });

    const renderCluster = (props: { reducedMotion?: boolean } = {}) =>
        render(
            <GlassActionCluster
                data-testid="cluster"
                reducedMotion={props.reducedMotion}
            >
                <button aria-label="First action" type="button">
                    A
                </button>
                <button aria-label="Second action" type="button">
                    B
                </button>
                <button aria-label="Third action" type="button">
                    C
                </button>
            </GlassActionCluster>
        );

    it("lays the children out in a single capsule container", () => {
        renderCluster();

        const cluster = screen.getByTestId("cluster");
        expect(cluster).toBeInTheDocument();
        // Stamps the glass-context marker so nested AntD overlays degrade
        // to opaque (never glass-on-glass).
        expect(cluster).toHaveAttribute("data-glass-context", "true");
        // All three controls live inside the one capsule.
        expect(cluster).toContainElement(
            screen.getByRole("button", { name: "First action" })
        );
        expect(cluster).toContainElement(
            screen.getByRole("button", { name: "Third action" })
        );
    });

    it("keeps each child individually focusable with its own label", () => {
        renderCluster();

        const first = screen.getByRole("button", { name: "First action" });
        const second = screen.getByRole("button", { name: "Second action" });
        const third = screen.getByRole("button", { name: "Third action" });

        // Three distinct, separately addressable controls — the shared
        // glass background does not merge them into one a11y element.
        expect(screen.getAllByRole("button")).toHaveLength(3);

        first.focus();
        expect(first).toHaveFocus();
        second.focus();
        expect(second).toHaveFocus();
        third.focus();
        expect(third).toHaveFocus();
    });

    it("wraps each child in its own slot so separators sit between, not at the edges", () => {
        const { container } = renderCluster();

        const slots = container.querySelectorAll(".pulse-cluster-slot");
        // One slot per child.
        expect(slots).toHaveLength(3);
        // The separator hairline is a slot ::after on every slot except
        // the last, so it never paints at the outer capsule rim. We can't
        // read pseudo-elements in jsdom, but we can assert the structural
        // contract the separators hang off: N slots, last one is the only
        // child with no trailing sibling.
        expect(slots[slots.length - 1]?.nextElementSibling).toBeNull();
    });

    it("filters out falsy children (conditional controls) without crashing", () => {
        render(
            <GlassActionCluster data-testid="cluster">
                <button aria-label="Only action" type="button">
                    A
                </button>
                {false}
                {null}
            </GlassActionCluster>
        );

        const { container } = render(
            <GlassActionCluster data-testid="cluster-2">
                <button aria-label="Only action 2" type="button">
                    A
                </button>
                {false}
                {null}
            </GlassActionCluster>
        );
        // Only the real control produces a slot; the false / null entries
        // are dropped.
        expect(container.querySelectorAll(".pulse-cluster-slot")).toHaveLength(
            1
        );
    });

    it("flattens fragment-wrapped children so each leaf control gets its own slot", () => {
        // The exact shape board.tsx passes: leaf controls nested inside
        // (conditionally-rendered) fragments. React.Children.toArray does
        // NOT descend into fragments, so without flattening this collapses
        // to a single slot and paints zero separators.
        const aiEnabled = true;
        const boardAiOn = true;
        const { container } = render(
            <GlassActionCluster data-testid="cluster-frag">
                <>
                    <button aria-label="Members" type="button">
                        M
                    </button>
                    {aiEnabled && (
                        <>
                            {boardAiOn && (
                                <>
                                    <button aria-label="Copilot" type="button">
                                        C
                                    </button>
                                </>
                            )}
                            <button aria-label="Settings" type="button">
                                S
                            </button>
                        </>
                    )}
                </>
            </GlassActionCluster>
        );

        // Three leaf controls → three slots → two separator boundaries.
        expect(container.querySelectorAll(".pulse-cluster-slot")).toHaveLength(
            3
        );
        expect(
            screen.getByRole("button", { name: "Members" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Copilot" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Settings" })
        ).toBeInTheDocument();
    });

    it("does not crash on the reduced-motion path", () => {
        expect(() => renderCluster({ reducedMotion: true })).not.toThrow();
        expect(screen.getByTestId("cluster")).toBeInTheDocument();
    });

    it("declares coarse-pointer hit areas for slots and buttons", () => {
        renderCluster();
        const cluster = screen.getByTestId("cluster");
        const styledClass = styledClassFor(cluster);
        expect(styledClass).toBeTruthy();

        const { heights, widths } = coarseTouchTargetsFor(styledClass ?? "");
        expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
        expect(Math.max(...widths)).toBeGreaterThanOrEqual(44);
    });

    it("has no axe violations", async () => {
        const { container } = renderCluster();
        expect(await axe(container)).toHaveNoViolations();
    });
});
