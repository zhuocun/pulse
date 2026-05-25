import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";

import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import SwipeableRow, {
    resolveSwipe,
    SWIPE_COMMIT_DISTANCE_RATIO,
    SWIPE_COMMIT_VELOCITY,
    type SwipeAction
} from ".";

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
 * `useIsPhoneChrome` / `useReducedMotion` are mocked directly (the
 * `pullToRefresh` suite's pattern) since the gating predicate reads
 * through them, not `matchMedia`. The global `setupTests.ts` already pins
 * `window.matchMedia` to `matches: false` for any incidental reads (AntD,
 * the hooks' own internals before the mock intercepts).
 */
const ROW_WIDTH = 320;

beforeEach(() => {
    jest.clearAllMocks();
});

/* -- resolveSwipe pure helper ------------------------------------------ */

describe("SwipeableRow — resolveSwipe pure helper", () => {
    const base = {
        velocityX: 0,
        rowWidth: ROW_WIDTH,
        hasLeading: true,
        hasTrailing: true
    };

    it("commits leading by distance past the ratio", () => {
        // 320 * 0.4 = 128 px commit threshold; 160 px clears it rightward.
        expect(resolveSwipe({ ...base, offsetX: 160 })).toEqual({
            kind: "commit",
            action: "leading"
        });
    });

    it("commits trailing by distance past the ratio", () => {
        expect(resolveSwipe({ ...base, offsetX: -160 })).toEqual({
            kind: "commit",
            action: "trailing"
        });
    });

    it("commits leading by fling velocity below the distance threshold", () => {
        // 20 px is well under the 128 px distance threshold, but a 900 px/s
        // rightward fling commits anyway.
        expect(resolveSwipe({ ...base, offsetX: 20, velocityX: 900 })).toEqual({
            kind: "commit",
            action: "leading"
        });
    });

    it("commits trailing by fling velocity below the distance threshold", () => {
        expect(
            resolveSwipe({ ...base, offsetX: -20, velocityX: -900 })
        ).toEqual({ kind: "commit", action: "trailing" });
    });

    it("snaps back below both distance and velocity thresholds", () => {
        // 40 px < 128 px, 100 px/s < 600 px/s → neither threshold met.
        expect(resolveSwipe({ ...base, offsetX: 40, velocityX: 100 })).toEqual({
            kind: "snap-back"
        });
        expect(
            resolveSwipe({ ...base, offsetX: -40, velocityX: -100 })
        ).toEqual({ kind: "snap-back" });
    });

    it("snaps back when the active direction has no action", () => {
        // Rightward (leading) past the threshold but no leading action.
        expect(
            resolveSwipe({
                ...base,
                offsetX: 200,
                velocityX: 900,
                hasLeading: false
            })
        ).toEqual({ kind: "snap-back" });
        // Leftward (trailing) past the threshold but no trailing action.
        expect(
            resolveSwipe({
                ...base,
                offsetX: -200,
                velocityX: -900,
                hasTrailing: false
            })
        ).toEqual({ kind: "snap-back" });
    });

    it("snaps back when both actions are undefined", () => {
        expect(
            resolveSwipe({
                offsetX: 300,
                velocityX: 1000,
                rowWidth: ROW_WIDTH,
                hasLeading: false,
                hasTrailing: false
            })
        ).toEqual({ kind: "snap-back" });
    });

    it("snaps back on a zero offset regardless of velocity", () => {
        expect(resolveSwipe({ ...base, offsetX: 0, velocityX: 5000 })).toEqual({
            kind: "snap-back"
        });
    });

    it("treats the velocity sign as direction-specific", () => {
        // A fast LEFTWARD velocity (negative) does NOT commit a rightward
        // (leading) offset — the directions must agree.
        expect(resolveSwipe({ ...base, offsetX: 20, velocityX: -900 })).toEqual(
            { kind: "snap-back" }
        );
    });

    it("exposes the commit threshold constants", () => {
        expect(SWIPE_COMMIT_DISTANCE_RATIO).toBe(0.4);
        expect(SWIPE_COMMIT_VELOCITY).toBe(600);
    });
});

/* -- Component test helpers -------------------------------------------- */

const makeAction = (
    key: string,
    overrides: Partial<SwipeAction> = {}
): SwipeAction => ({
    key,
    label: key === "leading" ? "Pin" : "Archive",
    icon: <span data-testid={`${key}-icon`}>icon</span>,
    background: key === "leading" ? "#10B981" : "#EF4444",
    onCommit: jest.fn(),
    ...overrides
});

/**
 * Stub `getBoundingClientRect` so the row reports a real width — jsdom
 * returns 0 (no layout), which the component falls back off of, but pinning
 * a fixed width makes the distance-threshold math deterministic in tests.
 */
const stubRowWidth = (node: HTMLElement, width = ROW_WIDTH): void => {
    node.getBoundingClientRect = jest.fn(
        () =>
            ({
                width,
                height: 64,
                top: 0,
                left: 0,
                right: width,
                bottom: 64,
                x: 0,
                y: 0,
                toJSON: () => ({})
            }) as DOMRect
    );
};

interface SetupOpts {
    leading?: SwipeAction | undefined;
    trailing?: SwipeAction | undefined;
    onChildClick?: () => void;
}

const setupPhone = ({ leading, trailing, onChildClick }: SetupOpts = {}): {
    leading: SwipeAction | undefined;
    trailing: SwipeAction | undefined;
    root: HTMLElement;
} => {
    mockedUseIsPhoneChrome.mockReturnValue(true);
    mockedUseReducedMotion.mockReturnValue(false);
    const leadingAction = leading ?? makeAction("leading");
    const trailingAction = trailing ?? makeAction("trailing");
    render(
        <SwipeableRow
            data-testid="row"
            leadingAction={leadingAction}
            trailingAction={trailingAction}
        >
            <button type="button" onClick={onChildClick}>
                Open project
            </button>
        </SwipeableRow>
    );
    const root = screen.getByTestId("row");
    stubRowWidth(root);
    return { leading: leadingAction, trailing: trailingAction, root };
};

/* -- Component — phone + motion ---------------------------------------- */

describe("SwipeableRow — gesture mode (phone + motion)", () => {
    it("renders both action panes aria-hidden behind the children", () => {
        setupPhone();
        const leadingPane = screen.getByTestId("row-leading");
        const trailingPane = screen.getByTestId("row-trailing");
        expect(leadingPane).toHaveAttribute("aria-hidden", "true");
        expect(trailingPane).toHaveAttribute("aria-hidden", "true");
        expect(
            screen.getByRole("button", { name: "Open project" })
        ).toBeInTheDocument();
    });

    it("commits the trailing action on a leftward swipe past the threshold", () => {
        const { trailing, root } = setupPhone();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 200, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 30, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });

        // 200 → 30 = -170 px leftward, past 320 * 0.4 = 128 → commit trailing.
        expect(trailing?.onCommit).toHaveBeenCalledTimes(1);
    });

    it("commits the leading action on a rightward swipe past the threshold", () => {
        const { leading, trailing, root } = setupPhone();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 100, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 280, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });

        // 100 → 280 = +180 px rightward, past 128 → commit leading.
        expect(leading?.onCommit).toHaveBeenCalledTimes(1);
        expect(trailing?.onCommit).not.toHaveBeenCalled();
    });

    it("snaps back without committing on a small sub-threshold swipe", () => {
        const { leading, trailing, root } = setupPhone();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 200, clientY: 100 }]
            });
        });
        // 200 → 175 = -25 px: past the 10 px activation slop (claimed) but
        // under the 128 px commit threshold → snap-back.
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 175, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });

        expect(leading?.onCommit).not.toHaveBeenCalled();
        expect(trailing?.onCommit).not.toHaveBeenCalled();
    });

    it("yields to vertical scroll — a vertical-dominant move never commits", () => {
        const { leading, trailing, root } = setupPhone();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 200, clientY: 100 }]
            });
        });
        // dx = -150 (past the distance threshold) but dy = -200 dominates,
        // so the gesture is abandoned as a scroll and never claimed.
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 50, clientY: 300 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });

        expect(leading?.onCommit).not.toHaveBeenCalled();
        expect(trailing?.onCommit).not.toHaveBeenCalled();
    });

    it("leaves the child fully clickable when the gesture is never claimed", async () => {
        const onChildClick = jest.fn();
        setupPhone({ onChildClick });
        const child = screen.getByRole("button", { name: "Open project" });

        const user = userEvent.setup();
        await user.click(child);

        expect(onChildClick).toHaveBeenCalledTimes(1);
    });

    it("hard-clamps the actionless direction — leftward with no trailing action snaps back", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
        const leading = makeAction("leading");
        // Render with ONLY a leading action: a leftward (trailing-edge)
        // swipe lands on a direction with no action and must snap back.
        render(
            <SwipeableRow data-testid="row" leadingAction={leading}>
                <button type="button">Open project</button>
            </SwipeableRow>
        );
        const root = screen.getByTestId("row");
        stubRowWidth(root);
        // No trailing pane renders when there is no trailing action.
        expect(screen.queryByTestId("row-trailing")).not.toBeInTheDocument();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 200, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 20, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });

        // Leftward over an actionless trailing edge → no commit.
        expect(leading.onCommit).not.toHaveBeenCalled();
    });

    it("commits only once across a single gesture", () => {
        const { trailing, root } = setupPhone();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 300, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 150, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 20, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });

        expect(trailing?.onCommit).toHaveBeenCalledTimes(1);
    });

    it("does NOT commit when a past-threshold gesture is touch-cancelled", () => {
        const { leading, trailing, root } = setupPhone();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 300, clientY: 100 }]
            });
        });
        // Claimed and well past the 128 px commit threshold...
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 20, clientY: 100 }]
            });
        });
        // ...but the OS reclaims the gesture — must snap back, never commit
        // (a stray destructive Delete on a cancelled swipe is unacceptable).
        act(() => {
            fireEvent.touchCancel(root);
        });

        expect(leading?.onCommit).not.toHaveBeenCalled();
        expect(trailing?.onCommit).not.toHaveBeenCalled();
    });

    it("passes axe with no a11y violations in gesture mode", async () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
        const { container } = render(
            <SwipeableRow
                data-testid="row"
                leadingAction={makeAction("leading")}
                trailingAction={makeAction("trailing")}
            >
                <button type="button">Open project</button>
            </SwipeableRow>
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

/* -- Passthrough ------------------------------------------------------- */

describe("SwipeableRow — passthrough (desktop / reduced-motion / disabled)", () => {
    it("renders children with no action panes on a non-coarse pointer", () => {
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
        render(
            <SwipeableRow
                data-testid="row"
                leadingAction={makeAction("leading")}
                trailingAction={makeAction("trailing")}
            >
                <button type="button">Open project</button>
            </SwipeableRow>
        );
        expect(
            screen.getByRole("button", { name: "Open project" })
        ).toBeInTheDocument();
        expect(screen.queryByTestId("row-leading")).not.toBeInTheDocument();
        expect(screen.queryByTestId("row-trailing")).not.toBeInTheDocument();
    });

    it("is a swipe no-op on desktop — a leftward drag never commits", async () => {
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
        const onChildClick = jest.fn();
        const trailing = makeAction("trailing");
        render(
            <SwipeableRow data-testid="row" trailingAction={trailing}>
                <button type="button" onClick={onChildClick}>
                    Open project
                </button>
            </SwipeableRow>
        );
        const root = screen.getByTestId("row");
        stubRowWidth(root);

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 300, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 20, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });
        expect(trailing.onCommit).not.toHaveBeenCalled();

        // The child still clicks through the passthrough wrapper.
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Open project" }));
        expect(onChildClick).toHaveBeenCalledTimes(1);
    });

    it("passes through with no listeners under reduced-motion", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(true);
        const trailing = makeAction("trailing");
        render(
            <SwipeableRow data-testid="row" trailingAction={trailing}>
                <button type="button">Open project</button>
            </SwipeableRow>
        );
        const root = screen.getByTestId("row");
        stubRowWidth(root);
        expect(screen.queryByTestId("row-trailing")).not.toBeInTheDocument();

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 300, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchMove(root, {
                touches: [{ clientX: 20, clientY: 100 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });
        expect(trailing.onCommit).not.toHaveBeenCalled();
    });

    it("forces passthrough when disabled, even on phone", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
        render(
            <SwipeableRow
                data-testid="row"
                disabled
                leadingAction={makeAction("leading")}
                trailingAction={makeAction("trailing")}
            >
                <button type="button">Open project</button>
            </SwipeableRow>
        );
        expect(screen.queryByTestId("row-leading")).not.toBeInTheDocument();
        expect(screen.queryByTestId("row-trailing")).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Open project" })
        ).toBeInTheDocument();
    });

    it("passes axe in passthrough mode", async () => {
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
        const { container } = render(
            <SwipeableRow
                data-testid="row"
                leadingAction={makeAction("leading")}
                trailingAction={makeAction("trailing")}
            >
                <button type="button">Open project</button>
            </SwipeableRow>
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
