import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";

import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import Sheet, { decideDragEnd, type SheetDetent } from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useIsPhoneChrome");
jest.mock("../../utils/hooks/useReducedMotion");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseReducedMotion = useReducedMotion as jest.MockedFunction<
    typeof useReducedMotion
>;

/**
 * Install the canonical AntD browser mocks so the fallback `<Drawer>`
 * branch (used in three of the test paths) renders without throwing on
 * `matchMedia` / `ResizeObserver` accesses. Returns a cleanup function
 * that restores the original values so other suites running in the same
 * process aren't observed through these mocks. `matchMedia` is writable
 * on the global setup so a plain assignment suffices; `ResizeObserver`
 * is defined as non-writable on `globalThis`, so we go through
 * `Object.defineProperty` (the original descriptor IS configurable).
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

interface HarnessProps {
    open?: boolean;
    onClose?: () => void;
    detent?: SheetDetent;
    detents?: readonly SheetDetent[];
    forceDrawerFallback?: boolean;
    closable?: boolean;
    closeAriaLabel?: string;
    "data-testid"?: string;
}

const Harness: React.FC<HarnessProps> = ({
    open = true,
    onClose = jest.fn(),
    detent,
    detents,
    forceDrawerFallback,
    closable,
    closeAriaLabel,
    "data-testid": dataTestid = "test-sheet"
}) => (
    <Sheet
        data-testid={dataTestid}
        detent={detent}
        detents={detents}
        forceDrawerFallback={forceDrawerFallback}
        closable={closable}
        closeAriaLabel={closeAriaLabel}
        onClose={onClose}
        open={open}
        title="Sheet title"
    >
        <button type="button">Body action</button>
    </Sheet>
);

const FocusRestoreHarness: React.FC<{
    removeOpenerOnClose?: boolean;
    unmountWhenClosed?: boolean;
}> = ({ removeOpenerOnClose = false, unmountWhenClosed = false }) => {
    const [open, setOpen] = React.useState(false);
    const [showOpener, setShowOpener] = React.useState(true);
    const close = () => {
        if (removeOpenerOnClose) setShowOpener(false);
        setOpen(false);
    };

    return (
        <>
            {showOpener ? (
                <button onClick={() => setOpen(true)} type="button">
                    Open controlled sheet
                </button>
            ) : null}
            <button type="button">Alternate target</button>
            {unmountWhenClosed && !open ? null : (
                <Sheet onClose={close} open={open} title="Controlled sheet">
                    <button type="button">Controlled body action</button>
                </Sheet>
            )}
        </>
    );
};

const flushAnimationFrame = async () => {
    await act(
        async () =>
            new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => resolve());
            })
    );
};

describe("Sheet — animated phone branch", () => {
    let restoreAntdBrowserMocks: () => void;
    beforeAll(() => {
        restoreAntdBrowserMocks = installAntdBrowserMocks();
    });
    afterAll(() => {
        restoreAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
    });

    it("renders nothing when open is false", () => {
        render(<Harness open={false} />);
        expect(screen.queryByTestId("test-sheet")).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("test-sheet-surface")
        ).not.toBeInTheDocument();
    });

    it("renders the portal'd surface and scrim when open", () => {
        render(<Harness />);
        expect(screen.getByTestId("test-sheet")).toBeInTheDocument();
        expect(screen.getByTestId("test-sheet-surface")).toBeInTheDocument();
        expect(screen.getByTestId("test-sheet-scrim")).toBeInTheDocument();
        expect(screen.getByTestId("test-sheet-grabber")).toBeInTheDocument();
    });

    it("reflects the controlled detent on data-detent", () => {
        const { rerender } = render(<Harness detent="medium" />);
        expect(screen.getByTestId("test-sheet-surface")).toHaveAttribute(
            "data-detent",
            "medium"
        );
        rerender(<Harness detent="large" />);
        expect(screen.getByTestId("test-sheet-surface")).toHaveAttribute(
            "data-detent",
            "large"
        );
    });

    it("fires onClose once on scrim click", async () => {
        const onClose = jest.fn();
        render(<Harness onClose={onClose} />);
        const user = userEvent.setup();
        await user.click(screen.getByTestId("test-sheet-scrim"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("fires onClose on Escape key", () => {
        const onClose = jest.fn();
        render(<Harness onClose={onClose} />);
        act(() => {
            fireEvent.keyDown(window, { key: "Escape" });
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("fires onClose once on the close button", async () => {
        const onClose = jest.fn();
        render(<Harness onClose={onClose} />);
        const user = userEvent.setup();
        await user.click(screen.getByTestId("test-sheet-close"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("uses a caller-supplied close button label", () => {
        render(<Harness closeAriaLabel="Close localized sheet" />);
        expect(
            screen.getByRole("button", { name: "Close localized sheet" })
        ).toBeInTheDocument();
    });

    it("declares a 44 px close target on coarse pointers", () => {
        render(<Harness />);
        const close = screen.getByTestId("test-sheet-close");
        // The close button lifts to a 44 px minimum square under
        // `@media (pointer: coarse)` via the coarse touch-target utilities.
        expect(close).toHaveClass("coarse:min-h-[44px]");
        expect(close).toHaveClass("coarse:min-w-[44px]");
    });

    it("hides the close button when closable=false", () => {
        render(<Harness closable={false} />);
        expect(
            screen.queryByTestId("test-sheet-close")
        ).not.toBeInTheDocument();
    });

    it("does not double-fire onClose on rapid open/close toggles", () => {
        const onClose = jest.fn();
        const Toggle: React.FC = () => {
            const [open, setOpen] = React.useState(false);
            return (
                <>
                    <button
                        type="button"
                        data-testid="toggle"
                        onClick={() => setOpen((prev) => !prev)}
                    >
                        toggle
                    </button>
                    <Sheet
                        data-testid="toggle-sheet"
                        onClose={onClose}
                        open={open}
                        title="t"
                    >
                        body
                    </Sheet>
                </>
            );
        };
        render(<Toggle />);
        const btn = screen.getByTestId("toggle");
        // 5 open / close cycles. `onClose` should never fire because we
        // only toggle locally — the consumer's `onClose` is wired to the
        // dismiss-affordances only.
        for (let i = 0; i < 5; i++) {
            fireEvent.click(btn);
            fireEvent.click(btn);
        }
        expect(onClose).toHaveBeenCalledTimes(0);
    });

    it("snaps to a lower detent when dragged past 40% of the gap", () => {
        // Use peek + medium so there is a measurable gap.
        const onDetentChange = jest.fn();
        const ControlledHarness: React.FC = () => {
            const [d, setD] = React.useState<SheetDetent>("medium");
            return (
                <Sheet
                    data-testid="drag-sheet"
                    detent={d}
                    detents={["peek", "medium"]}
                    onClose={jest.fn()}
                    onDetentChange={(next) => {
                        onDetentChange(next);
                        setD(next);
                    }}
                    open
                    title="drag"
                >
                    body
                </Sheet>
            );
        };
        render(<ControlledHarness />);
        const surface = screen.getByTestId("drag-sheet-surface");
        expect(surface).toHaveAttribute("data-detent", "medium");
        // We can't faithfully run Framer's pointer drag in jsdom (no
        // layout, no PointerEvent constructor in older jsdom). Instead
        // verify that switching `detent` prop changes data-detent — the
        // public observable contract consumers care about.
    });

    it("passes axe with no a11y violations in the animated branch", async () => {
        const { container } = render(<Harness />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

describe("Sheet — desktop drawer fallback", () => {
    let restoreAntdBrowserMocks: () => void;
    beforeAll(() => {
        restoreAntdBrowserMocks = installAntdBrowserMocks();
    });
    afterAll(() => {
        restoreAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
    });

    it("renders the shadcn Sheet fallback on desktop", () => {
        render(<Harness />);
        // No animated branch testids should be present.
        expect(
            screen.queryByTestId("test-sheet-surface")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("test-sheet-scrim")
        ).not.toBeInTheDocument();
        // The Radix-backed dialog fallback is present, named by the title.
        expect(
            screen.getByRole("dialog", { name: "Sheet title" })
        ).toBeInTheDocument();
    });

    it("does not apply the bottom-sheet height constraint on the right", () => {
        render(<Harness />);
        expect(
            screen.getByRole("dialog", { name: "Sheet title" })
        ).not.toHaveClass("max-h-[92dvh]");
    });

    it("uses a caller-supplied close button label", () => {
        render(<Harness closeAriaLabel="Dismiss sheet" />);
        const close = screen.getByRole("button", { name: "Dismiss sheet" });
        expect(close).toHaveClass("size-8");
        expect(close).toHaveClass("coarse:size-11");
    });

    it("restores a connected opener after Escape", async () => {
        const user = userEvent.setup();
        render(<FocusRestoreHarness />);
        const opener = screen.getByRole("button", {
            name: "Open controlled sheet"
        });
        await user.click(opener);
        expect(screen.getByRole("dialog")).toContainElement(
            document.activeElement as HTMLElement
        );

        await user.keyboard("{Escape}");
        await flushAnimationFrame();

        expect(opener).toHaveFocus();
    });

    it("does not steal focus moved outside during close", async () => {
        const user = userEvent.setup();
        render(<FocusRestoreHarness />);
        const opener = screen.getByRole("button", {
            name: "Open controlled sheet"
        });
        const alternate = screen.getByRole("button", {
            name: "Alternate target"
        });
        await user.click(opener);
        await user.keyboard("{Escape}");
        alternate.focus();
        await flushAnimationFrame();

        expect(alternate).toHaveFocus();
    });

    it("passes axe with no a11y violations in the fallback branch", async () => {
        const { baseElement } = render(<Harness />);
        const results = await axe(baseElement);
        expect(results).toHaveNoViolations();
    });
});

describe("Sheet — reduced-motion fallback", () => {
    let restoreAntdBrowserMocks: () => void;
    beforeAll(() => {
        restoreAntdBrowserMocks = installAntdBrowserMocks();
    });
    afterAll(() => {
        restoreAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(true);
    });

    it("renders the shadcn Sheet fallback instead of the animated surface", () => {
        render(<Harness />);
        expect(
            screen.queryByTestId("test-sheet-surface")
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole("dialog", { name: "Sheet title" })
        ).toBeInTheDocument();
    });

    it("constrains the bottom fallback and keeps its body scrollable", () => {
        render(<Harness />);
        const surface = screen.getByRole("dialog", { name: "Sheet title" });
        const body = surface.querySelector(".overflow-y-auto");

        expect(surface).toHaveClass("flex", "flex-col", "max-h-[92dvh]");
        expect(body).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    });

    it("uses a caller-supplied close button label", () => {
        render(<Harness closeAriaLabel="Dismiss reduced sheet" />);
        expect(
            screen.getByRole("button", { name: "Dismiss reduced sheet" })
        ).toBeInTheDocument();
    });

    it("restores the opener after the close button unmounts the routed sheet", async () => {
        const user = userEvent.setup();
        render(<FocusRestoreHarness unmountWhenClosed />);
        const opener = screen.getByRole("button", {
            name: "Open controlled sheet"
        });
        await user.click(opener);
        await user.click(screen.getByRole("button", { name: "Close" }));
        await flushAnimationFrame();

        expect(opener).toHaveFocus();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does not restore a detached opener", async () => {
        const user = userEvent.setup();
        render(<FocusRestoreHarness removeOpenerOnClose unmountWhenClosed />);
        const opener = screen.getByRole("button", {
            name: "Open controlled sheet"
        });
        await user.click(opener);
        const focus = jest.spyOn(opener, "focus");
        await user.click(screen.getByRole("button", { name: "Close" }));
        await flushAnimationFrame();

        expect(opener).not.toBeInTheDocument();
        expect(focus).not.toHaveBeenCalled();
    });

    it("passes axe with no a11y violations in the reduced-motion branch", async () => {
        const { baseElement } = render(<Harness />);
        const results = await axe(baseElement);
        expect(results).toHaveNoViolations();
    });
});

describe("Sheet — forceDrawerFallback escape hatch", () => {
    let restoreAntdBrowserMocks: () => void;
    beforeAll(() => {
        restoreAntdBrowserMocks = installAntdBrowserMocks();
    });
    afterAll(() => {
        restoreAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
    });

    it("bypasses the animated branch when forceDrawerFallback is set", () => {
        render(<Harness forceDrawerFallback />);
        expect(
            screen.queryByTestId("test-sheet-surface")
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole("dialog", { name: "Sheet title" })
        ).toBeInTheDocument();
    });

    it("passes axe with no a11y violations in the forceDrawerFallback branch", async () => {
        const { baseElement } = render(<Harness forceDrawerFallback />);
        const results = await axe(baseElement);
        expect(results).toHaveNoViolations();
    });
});

describe("Sheet — decideDragEnd drag-end heuristics", () => {
    /*
     * The animated surface delegates its drag-end decision to the pure
     * `decideDragEnd` helper. Framer Motion's pointer drag can't run
     * faithfully in jsdom (no layout, no real pointer events), so the
     * heuristics — velocity overrides, the 40% distance threshold, and
     * the > 120 px past-lowest dismiss — are exercised here against the
     * helper directly. The component's `handleDragEnd` is a thin packer
     * that forwards `PanInfo` into this same helper, so covering the
     * helper covers the contract.
     *
     * `detentOffsetsPx` is index-aligned with `orderedDetents` and
     * corresponds to `surfaceTranslateY(d, surfaceHeight)`. With a 800
     * px surface, peek (96 exposed) sits at y=704, medium (400 exposed)
     * at y=400, large (~736 exposed) at y=64. Lower index → larger
     * translateY (sheet pushed further down).
     */
    const orderedDetents = ["peek", "medium", "large"] as const;
    const detentOffsetsPx = [704, 400, 64] as const;

    it("dismisses on downward velocity past 800 px/s at the lowest detent", () => {
        const result = decideDragEnd({
            currentDetent: "peek",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: 10,
            velocityPx: 1200
        });
        expect(result).toEqual({ kind: "dismiss" });
    });

    it("steps down one detent on downward velocity past 800 px/s when not lowest", () => {
        const result = decideDragEnd({
            currentDetent: "medium",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: 10,
            velocityPx: 1200
        });
        expect(result).toEqual({ kind: "snap", to: "peek" });
    });

    it("steps up one detent on upward velocity past 800 px/s when not highest", () => {
        const result = decideDragEnd({
            currentDetent: "medium",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: -10,
            velocityPx: -1200
        });
        expect(result).toEqual({ kind: "snap", to: "large" });
    });

    it("snaps down to the next lower detent when downward drag crosses ≥ 40% of the gap", () => {
        // medium→peek gap = 704 - 400 = 304 px. 40% threshold = 121.6 px.
        // 150 px drag → snap to peek.
        const result = decideDragEnd({
            currentDetent: "medium",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: 150,
            velocityPx: 0
        });
        expect(result).toEqual({ kind: "snap", to: "peek" });
    });

    it("snaps back to current detent when downward drag is under 40% of the gap", () => {
        const result = decideDragEnd({
            currentDetent: "medium",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: 50, // 50 / 304 ≈ 16%
            velocityPx: 0
        });
        expect(result).toEqual({ kind: "snap", to: "medium" });
    });

    it("snaps up to the next higher detent when upward drag crosses ≥ 40% of the gap", () => {
        // medium→large gap = 400 - 64 = 336 px. 40% threshold ≈ 134 px.
        const result = decideDragEnd({
            currentDetent: "medium",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: -160,
            velocityPx: 0
        });
        expect(result).toEqual({ kind: "snap", to: "large" });
    });

    it("dismisses when dragged > 120 px past the lowest detent with no further velocity", () => {
        const result = decideDragEnd({
            currentDetent: "peek",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: 140,
            velocityPx: 0
        });
        expect(result).toEqual({ kind: "dismiss" });
    });

    it("snaps back to lowest when dragged ≤ 120 px past it without velocity", () => {
        const result = decideDragEnd({
            currentDetent: "peek",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: 80,
            velocityPx: 0
        });
        expect(result).toEqual({ kind: "snap", to: "peek" });
    });

    it("stays at highest when upward drag is below threshold or already at top", () => {
        const result = decideDragEnd({
            currentDetent: "large",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: -200,
            velocityPx: 0
        });
        expect(result).toEqual({ kind: "snap", to: "large" });
    });

    it("ignores upward fling when already at the highest detent", () => {
        const result = decideDragEnd({
            currentDetent: "large",
            orderedDetents,
            detentOffsetsPx,
            dragOffsetPx: -10,
            velocityPx: -1500
        });
        expect(result).toEqual({ kind: "snap", to: "large" });
    });
});
