import { act, renderHook } from "@testing-library/react";

import useDelayedFlag from "./useDelayedFlag";

describe("useDelayedFlag", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("returns false until the flag remains true past the delay", () => {
        const { result, rerender } = renderHook(
            ({ flag }) => useDelayedFlag(flag, 250),
            { initialProps: { flag: false } }
        );

        expect(result.current).toBe(false);

        rerender({ flag: true });
        expect(result.current).toBe(false);

        act(() => {
            jest.advanceTimersByTime(249);
        });
        expect(result.current).toBe(false);

        act(() => {
            jest.advanceTimersByTime(2);
        });
        expect(result.current).toBe(true);
    });

    it("clears immediately when the source flag drops to false", () => {
        const { result, rerender } = renderHook(
            ({ flag }) => useDelayedFlag(flag, 250),
            { initialProps: { flag: true } }
        );

        act(() => {
            jest.advanceTimersByTime(250);
        });
        expect(result.current).toBe(true);

        rerender({ flag: false });
        expect(result.current).toBe(false);
    });

    it("never flips true when loading ends before the delay", () => {
        const { result, rerender } = renderHook(
            ({ flag }) => useDelayedFlag(flag, 250),
            { initialProps: { flag: false } }
        );

        rerender({ flag: true });

        act(() => {
            jest.advanceTimersByTime(100);
        });
        expect(result.current).toBe(false);

        rerender({ flag: false });
        expect(result.current).toBe(false);

        act(() => {
            jest.advanceTimersByTime(500);
        });
        expect(result.current).toBe(false);
    });
});
