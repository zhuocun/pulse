import { act, renderHook } from "@testing-library/react";

import useScrollDirection from "./useScrollDirection";

/*
 * Phase 6 Wave 2 T5 — `useScrollDirection` drives the BottomTabBar's
 * minimize-on-scroll behaviour. The tests below cover the four
 * canonical states (idle / down / up / no-flip below threshold) plus
 * the hysteresis lockout and the in-flight view-transition pause.
 */

/* Helpers — set scrollY, dispatch a scroll event, advance the wall
 * clock so the min-duration lockout windows can be exercised. */
const setScrollY = (y: number): void => {
    Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: y
    });
};

const fireScroll = (): void => {
    window.dispatchEvent(new Event("scroll"));
};

describe("useScrollDirection", () => {
    let nowSpy: jest.SpyInstance<number, []>;
    let nowMs = 0;

    beforeEach(() => {
        setScrollY(0);
        nowMs = 1_000_000;
        nowSpy = jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        delete (document as Partial<Document>).startViewTransition;
        setScrollY(0);
    });

    it("returns 'idle' on initial mount", () => {
        const { result } = renderHook(() => useScrollDirection());
        expect(result.current).toBe("idle");
    });

    it("flips to 'down' after scrolling past the threshold", () => {
        const { result } = renderHook(() =>
            useScrollDirection({ threshold: 50 })
        );
        act(() => {
            setScrollY(60);
            fireScroll();
        });
        expect(result.current).toBe("down");
    });

    it("flips to 'up' after scrolling back past the threshold", () => {
        const { result } = renderHook(() =>
            useScrollDirection({ threshold: 50, minStateDurationMs: 0 })
        );
        act(() => {
            setScrollY(80);
            fireScroll();
        });
        expect(result.current).toBe("down");
        act(() => {
            setScrollY(10);
            fireScroll();
        });
        expect(result.current).toBe("up");
    });

    it("does NOT flip when scroll delta is below the threshold (hysteresis)", () => {
        // Below 50px cumulative motion should stay 'idle'.
        const { result } = renderHook(() =>
            useScrollDirection({ threshold: 50 })
        );
        act(() => {
            setScrollY(20);
            fireScroll();
        });
        expect(result.current).toBe("idle");
        act(() => {
            setScrollY(40); // cumulative 40, still under 50
            fireScroll();
        });
        expect(result.current).toBe("idle");
    });

    it("does not re-toggle within minStateDurationMs window", () => {
        // After a flip, subsequent reversals within the lockout window
        // are dropped to prevent flicker on rapid scroll reversals.
        const { result } = renderHook(() =>
            useScrollDirection({ threshold: 50, minStateDurationMs: 300 })
        );
        act(() => {
            setScrollY(200);
            fireScroll();
        });
        expect(result.current).toBe("down");
        // Reverse direction within the lockout window — must not flip.
        // (Stays above scrollY 0 so the top-of-page force-restore does
        // not apply.)
        act(() => {
            nowMs += 100; // still inside 300ms
            setScrollY(140);
            fireScroll();
        });
        expect(result.current).toBe("down");
        // After the lockout expires, the reversal should land.
        act(() => {
            nowMs += 400;
            setScrollY(60);
            fireScroll();
        });
        expect(result.current).toBe("up");
    });

    it("resets the direction-accumulator on a direction reversal so a small reversal does not bleed a flip", () => {
        // Scroll down 60 (accum = 60, flip to down), pause longer than
        // the lockout, then scroll up 30 — should NOT flip to up
        // because 30 < threshold 50 after the reset.
        const { result } = renderHook(() =>
            useScrollDirection({ threshold: 50, minStateDurationMs: 100 })
        );
        act(() => {
            setScrollY(60);
            fireScroll();
        });
        expect(result.current).toBe("down");
        act(() => {
            nowMs += 200;
            setScrollY(30); // delta -30 from 60
            fireScroll();
        });
        // 30px is still below the threshold; direction stays "down".
        expect(result.current).toBe("down");
    });

    it("force-restores to 'idle' when scrollY reaches 0, bypassing threshold and lockout", () => {
        const { result } = renderHook(() =>
            useScrollDirection({ threshold: 50, minStateDurationMs: 300 })
        );
        act(() => {
            setScrollY(80);
            fireScroll();
        });
        expect(result.current).toBe("down");
        // Jump straight back to the top INSIDE the lockout window — the
        // forced restore must still land.
        act(() => {
            nowMs += 100;
            setScrollY(0);
            fireScroll();
        });
        expect(result.current).toBe("idle");
    });

    it("resets to 'idle' when resetKey changes (navigation)", () => {
        const { result, rerender } = renderHook(
            ({ resetKey }: { resetKey: string }) =>
                useScrollDirection({ threshold: 50, resetKey }),
            { initialProps: { resetKey: "/projects" } }
        );
        act(() => {
            setScrollY(80);
            fireScroll();
        });
        expect(result.current).toBe("down");
        rerender({ resetKey: "/inbox" });
        expect(result.current).toBe("idle");
    });

    it("pauses direction updates while a view transition is in flight", async () => {
        // Mock startViewTransition with a `finished` promise we control
        // so we can run scrolls "during" the transition and confirm
        // the gate suppresses direction flips until the promise
        // resolves.
        let resolveFinished: (() => void) | null = null;
        const finished = new Promise<void>((resolve) => {
            resolveFinished = resolve;
        });
        const transition = { finished };
        const startSpy = jest.fn().mockReturnValue(transition);
        (
            document as Document & {
                startViewTransition?: typeof startSpy;
            }
        ).startViewTransition = startSpy;

        const { result } = renderHook(() =>
            useScrollDirection({
                threshold: 50,
                minStateDurationMs: 0,
                pauseDuringViewTransition: true
            })
        );
        // Trigger a transition.
        act(() => {
            (
                document as Document & {
                    startViewTransition?: typeof startSpy;
                }
            ).startViewTransition?.(() => {});
        });
        expect(startSpy).toHaveBeenCalledTimes(1);
        // Scroll during transition — direction should NOT flip.
        act(() => {
            setScrollY(120);
            fireScroll();
        });
        expect(result.current).toBe("idle");
        // Complete the transition.
        await act(async () => {
            resolveFinished?.();
            await finished;
        });
        // Now a scroll past the threshold should flip.
        act(() => {
            setScrollY(240);
            fireScroll();
        });
        expect(result.current).toBe("down");
    });

    it("falls back gracefully when startViewTransition mock omits `finished`", async () => {
        // Some older impls / tighter mocks return an object without
        // `finished`. The hook should still release the gate (via a
        // microtask) instead of latching forever.
        const startSpy = jest.fn().mockReturnValue({});
        (
            document as Document & {
                startViewTransition?: typeof startSpy;
            }
        ).startViewTransition = startSpy;
        const { result } = renderHook(() =>
            useScrollDirection({
                threshold: 50,
                minStateDurationMs: 0,
                pauseDuringViewTransition: true
            })
        );
        act(() => {
            (
                document as Document & {
                    startViewTransition?: typeof startSpy;
                }
            ).startViewTransition?.(() => {});
        });
        // Microtask drain — the release should fire.
        await act(async () => {
            await Promise.resolve();
        });
        act(() => {
            setScrollY(120);
            fireScroll();
        });
        expect(result.current).toBe("down");
    });

    it("restores the original startViewTransition on unmount", () => {
        const original = jest.fn();
        (
            document as Document & {
                startViewTransition?: typeof original;
            }
        ).startViewTransition = original;
        const { unmount } = renderHook(() =>
            useScrollDirection({ pauseDuringViewTransition: true })
        );
        // Hook installed its wrapper — the reference is no longer the
        // original.
        expect(
            (
                document as Document & {
                    startViewTransition?: typeof original;
                }
            ).startViewTransition
        ).not.toBe(original);
        unmount();
        // After unmount, the original is restored.
        expect(
            (
                document as Document & {
                    startViewTransition?: typeof original;
                }
            ).startViewTransition
        ).toBe(original);
    });

    it("does not install the startViewTransition wrap when pauseDuringViewTransition=false", () => {
        const original = jest.fn();
        (
            document as Document & {
                startViewTransition?: typeof original;
            }
        ).startViewTransition = original;
        renderHook(() =>
            useScrollDirection({ pauseDuringViewTransition: false })
        );
        // No wrap installed — original is untouched.
        expect(
            (
                document as Document & {
                    startViewTransition?: typeof original;
                }
            ).startViewTransition
        ).toBe(original);
    });

    it("cleans up the scroll listener on unmount", () => {
        const removeSpy = jest.spyOn(window, "removeEventListener");
        const { unmount } = renderHook(() => useScrollDirection());
        unmount();
        expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
        removeSpy.mockRestore();
    });
});
