import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import PullToRefresh, {
    MAX_PULL_PX,
    PULL_DAMPING,
    PULL_THRESHOLD_PX,
    resolvePull
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
 * Pin `document.scrollingElement.scrollTop` so the gesture's "only engage
 * at the top of the document" guard is deterministic. jsdom does NOT
 * resolve `document.scrollingElement` (it is `null`, and its `scrollTop`
 * getter is hard-wired to 0 and ignores writes), so we stub the property
 * with a plain object exposing a settable `scrollTop`. The original
 * descriptor is restored in `afterEach` so other suites aren't observed
 * through the stub.
 */
const originalScrollingElement = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "scrollingElement"
);

const pinScrollTop = (value: number): void => {
    Object.defineProperty(document, "scrollingElement", {
        configurable: true,
        get: () => ({ scrollTop: value }) as unknown as Element
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    pinScrollTop(0);
});

afterEach(() => {
    delete (document as { scrollingElement?: unknown }).scrollingElement;
    if (originalScrollingElement) {
        Object.defineProperty(
            Document.prototype,
            "scrollingElement",
            originalScrollingElement
        );
    }
});

describe("PullToRefresh — resolvePull pure helper", () => {
    it("clamps upward / zero drags to a no-op", () => {
        expect(resolvePull({ rawDelta: 0, threshold: 64, max: 96 })).toEqual({
            offset: 0,
            willRefresh: false
        });
        expect(resolvePull({ rawDelta: -120, threshold: 64, max: 96 })).toEqual(
            { offset: 0, willRefresh: false }
        );
    });

    it("damps the raw finger delta by the damping factor", () => {
        // 100 px finger travel × 0.5 damping = 50 px offset (below 64 → no refresh).
        expect(resolvePull({ rawDelta: 100, threshold: 64, max: 96 })).toEqual({
            offset: 50,
            willRefresh: false
        });
    });

    it("flips willRefresh once the damped offset crosses the threshold", () => {
        // 130 px × 0.5 = 65 px ≥ 64 threshold → willRefresh.
        expect(resolvePull({ rawDelta: 130, threshold: 64, max: 96 })).toEqual({
            offset: 65,
            willRefresh: true
        });
        // Exactly at threshold (128 × 0.5 = 64) → willRefresh (>=).
        expect(
            resolvePull({ rawDelta: 128, threshold: 64, max: 96 }).willRefresh
        ).toBe(true);
        // Just under (126 × 0.5 = 63) → no refresh.
        expect(
            resolvePull({ rawDelta: 126, threshold: 64, max: 96 }).willRefresh
        ).toBe(false);
    });

    it("clamps the offset to max no matter how far the finger travels", () => {
        // 1000 px × 0.5 = 500, clamped to 96.
        expect(resolvePull({ rawDelta: 1000, threshold: 64, max: 96 })).toEqual(
            { offset: 96, willRefresh: true }
        );
    });

    it("honors a custom damping factor", () => {
        expect(
            resolvePull({ rawDelta: 100, threshold: 64, max: 96, damping: 1 })
        ).toEqual({ offset: 96, willRefresh: true });
    });

    it("uses PULL_DAMPING as the default damping", () => {
        expect(
            resolvePull({
                rawDelta: 40,
                threshold: PULL_THRESHOLD_PX,
                max: MAX_PULL_PX
            }).offset
        ).toBe(40 * PULL_DAMPING);
    });
});

describe("PullToRefresh — button mode (phone + reduced-motion)", () => {
    beforeEach(() => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(true);
    });

    it("renders a refresh button and the children", () => {
        render(
            <PullToRefresh data-testid="ptr" onRefresh={jest.fn()}>
                <p>Body content</p>
            </PullToRefresh>
        );
        expect(screen.getByTestId("ptr-button")).toBeInTheDocument();
        expect(screen.getByText("Body content")).toBeInTheDocument();
        // No gesture indicator in button mode.
        expect(screen.queryByTestId("ptr-indicator")).not.toBeInTheDocument();
        // Default label is the refresh microcopy key.
        expect(
            screen.getByRole("button", { name: microcopy.actions.refresh })
        ).toBeInTheDocument();
    });

    it("uses a custom refreshLabel when provided", () => {
        render(
            <PullToRefresh
                data-testid="ptr"
                onRefresh={jest.fn()}
                refreshLabel="Reload now"
            >
                <p>Body</p>
            </PullToRefresh>
        );
        expect(
            screen.getByRole("button", { name: "Reload now" })
        ).toBeInTheDocument();
    });

    it("calls onRefresh on click and shows a spinner until the promise resolves", async () => {
        let resolveRefresh: (() => void) | undefined;
        const onRefresh = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveRefresh = resolve;
                })
        );
        render(
            <PullToRefresh data-testid="ptr" onRefresh={onRefresh}>
                <p>Body</p>
            </PullToRefresh>
        );
        const user = userEvent.setup();
        const button = screen.getByTestId("ptr-button");

        await user.click(button);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        // While pending, the Button reflects loading via aria-busy.
        await waitFor(() =>
            expect(button).toHaveAttribute("aria-busy", "true")
        );

        // Resolve the refresh — spinner clears.
        await act(async () => {
            resolveRefresh?.();
        });
        await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    });

    it("reflects an externally-controlled refreshing prop on the spinner", () => {
        render(
            <PullToRefresh data-testid="ptr" onRefresh={jest.fn()} refreshing>
                <p>Body</p>
            </PullToRefresh>
        );
        expect(screen.getByTestId("ptr-button")).toHaveAttribute(
            "aria-busy",
            "true"
        );
    });

    it("passes axe with no a11y violations in button mode", async () => {
        const { container } = render(
            <PullToRefresh data-testid="ptr" onRefresh={jest.fn()}>
                <p>Body</p>
            </PullToRefresh>
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

describe("PullToRefresh — gesture mode (phone + motion)", () => {
    beforeEach(() => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
    });

    const renderGesture = (onRefresh = jest.fn()) => {
        const utils = render(
            <PullToRefresh data-testid="ptr" onRefresh={onRefresh}>
                <p>Body content</p>
            </PullToRefresh>
        );
        return { ...utils, onRefresh, root: screen.getByTestId("ptr") };
    };

    it("renders the live-region indicator with the resting 'pull' status", () => {
        renderGesture();
        const indicator = screen.getByTestId("ptr-indicator");
        expect(indicator).toBeInTheDocument();
        expect(indicator).toHaveAttribute("role", "status");
        expect(indicator).toHaveAttribute("aria-live", "polite");
        expect(indicator).toHaveTextContent(microcopy.pullToRefresh.pull);
        // No button in gesture mode.
        expect(screen.queryByTestId("ptr-button")).not.toBeInTheDocument();
    });

    it("flips the status text to 'release' once the pull crosses the threshold", () => {
        const { root } = renderGesture();
        const indicator = screen.getByTestId("ptr-indicator");

        act(() => {
            fireEvent.touchStart(root, { touches: [{ clientY: 0 }] });
        });
        // A small pull (40 px × 0.5 = 20 px, < 64) stays on "pull".
        act(() => {
            fireEvent.touchMove(root, { touches: [{ clientY: 40 }] });
        });
        expect(indicator).toHaveTextContent(microcopy.pullToRefresh.pull);

        // A large pull (200 px × 0.5 = 100 → clamped 96, ≥ 64) flips to "release".
        act(() => {
            fireEvent.touchMove(root, { touches: [{ clientY: 200 }] });
        });
        expect(indicator).toHaveTextContent(microcopy.pullToRefresh.release);
    });

    it("fires onRefresh only when released past the threshold", () => {
        const { root, onRefresh } = renderGesture();

        // Release after a sub-threshold pull → no refresh.
        act(() => {
            fireEvent.touchStart(root, { touches: [{ clientY: 0 }] });
        });
        act(() => {
            fireEvent.touchMove(root, { touches: [{ clientY: 40 }] });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });
        expect(onRefresh).not.toHaveBeenCalled();

        // Release after a past-threshold pull → refresh fires.
        act(() => {
            fireEvent.touchStart(root, { touches: [{ clientY: 0 }] });
        });
        act(() => {
            fireEvent.touchMove(root, { touches: [{ clientY: 200 }] });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("shows the 'refreshing' status while in flight, then snaps back to 'pull'", async () => {
        let resolveRefresh: (() => void) | undefined;
        const onRefresh = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveRefresh = resolve;
                })
        );
        const { root } = renderGesture(onRefresh);
        const indicator = screen.getByTestId("ptr-indicator");

        act(() => {
            fireEvent.touchStart(root, { touches: [{ clientY: 0 }] });
        });
        act(() => {
            fireEvent.touchMove(root, { touches: [{ clientY: 200 }] });
        });
        // Armed but pre-release: the flipped arrow + "release", NOT a
        // spinner — the spinner is reserved for the in-flight fetch.
        expect(indicator).toHaveTextContent(microcopy.pullToRefresh.release);

        act(() => {
            fireEvent.touchEnd(root);
        });
        // Released past threshold → onRefresh is awaiting → "refreshing".
        await waitFor(() =>
            expect(indicator).toHaveTextContent(
                microcopy.pullToRefresh.refreshing
            )
        );

        // Resolve the in-flight refresh → indicator snaps back to rest.
        await act(async () => {
            resolveRefresh?.();
        });
        await waitFor(() =>
            expect(indicator).toHaveTextContent(microcopy.pullToRefresh.pull)
        );
    });

    it("does not engage a pull when the document is scrolled below the top", () => {
        pinScrollTop(120);
        const { root, onRefresh } = renderGesture();
        const indicator = screen.getByTestId("ptr-indicator");

        act(() => {
            fireEvent.touchStart(root, { touches: [{ clientY: 0 }] });
        });
        act(() => {
            fireEvent.touchMove(root, { touches: [{ clientY: 200 }] });
        });
        act(() => {
            fireEvent.touchEnd(root);
        });
        // Never crossed → status stays on "pull", refresh never fires.
        expect(indicator).toHaveTextContent(microcopy.pullToRefresh.pull);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it("passes axe with no a11y violations in gesture mode", async () => {
        const { container } = renderGesture();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

describe("PullToRefresh — passthrough (desktop / disabled)", () => {
    it("renders children only on desktop (no button, no indicator)", () => {
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
        render(
            <PullToRefresh data-testid="ptr" onRefresh={jest.fn()}>
                <p>Body content</p>
            </PullToRefresh>
        );
        expect(screen.getByText("Body content")).toBeInTheDocument();
        expect(screen.queryByTestId("ptr-button")).not.toBeInTheDocument();
        expect(screen.queryByTestId("ptr-indicator")).not.toBeInTheDocument();
    });

    it("renders children only when disabled, even on phone", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
        render(
            <PullToRefresh data-testid="ptr" disabled onRefresh={jest.fn()}>
                <p>Body content</p>
            </PullToRefresh>
        );
        expect(screen.getByText("Body content")).toBeInTheDocument();
        expect(screen.queryByTestId("ptr-button")).not.toBeInTheDocument();
        expect(screen.queryByTestId("ptr-indicator")).not.toBeInTheDocument();
    });
});
