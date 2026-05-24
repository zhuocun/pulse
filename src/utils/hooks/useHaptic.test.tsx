import { act, renderHook } from "@testing-library/react";

import useHaptic, { HAPTIC_PATTERNS, type HapticPattern } from "./useHaptic";

/*
 * JSDOM does not ship `navigator.vibrate`, so we install / strip it
 * per-test to exercise both the supported and unsupported branches.
 * We type the mutable surface as a record with an optional
 * `vibrate` field so the cast satisfies both TS (the lib.dom
 * declaration overloads on Iterable<number>) and the deletion
 * operator (which requires an optional property).
 */
type VibrateFn = Navigator["vibrate"];
type VibrateSurface = { vibrate?: VibrateFn };

const installVibrate = (): jest.Mock<boolean, [number | number[]]> => {
    const spy = jest.fn().mockReturnValue(true) as jest.Mock<
        boolean,
        [number | number[]]
    >;
    (navigator as unknown as VibrateSurface).vibrate =
        spy as unknown as VibrateFn;
    return spy;
};

const uninstallVibrate = (): void => {
    delete (navigator as unknown as VibrateSurface).vibrate;
};

afterEach(() => {
    uninstallVibrate();
});

describe("useHaptic", () => {
    it("returns a vibrate function", () => {
        const { result } = renderHook(() => useHaptic());
        expect(typeof result.current.vibrate).toBe("function");
    });

    it("calls navigator.vibrate when feature is supported", () => {
        const spy = installVibrate();
        const { result } = renderHook(() => useHaptic());
        act(() => result.current.vibrate("tap"));
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(HAPTIC_PATTERNS.tap);
    });

    it("is a no-op when navigator.vibrate is not present (iOS Safari)", () => {
        uninstallVibrate();
        const { result } = renderHook(() => useHaptic());
        // Should not throw; should not affect any global state we can
        // observe — the assertion is the absence of a thrown error
        // plus the lack of any property landing on `navigator`.
        expect(() =>
            act(() => result.current.vibrate("success"))
        ).not.toThrow();
        expect(
            (navigator as unknown as VibrateSurface).vibrate
        ).toBeUndefined();
    });

    it("does not throw if navigator.vibrate itself throws", () => {
        const spy = jest.fn().mockImplementation(() => {
            throw new Error("vibration policy denied");
        }) as jest.Mock<boolean, [number | number[]]>;
        (navigator as unknown as VibrateSurface).vibrate =
            spy as unknown as VibrateFn;
        const { result } = renderHook(() => useHaptic());
        expect(() => act(() => result.current.vibrate("error"))).not.toThrow();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it.each<[HapticPattern, number | number[]]>([
        ["tap", 10],
        ["success", [10, 40, 20]],
        ["warning", [40, 40]],
        ["error", [40, 40, 40]]
    ])(
        "maps the '%s' pattern to the expected vibration sequence",
        (pattern, expected) => {
            const spy = installVibrate();
            const { result } = renderHook(() => useHaptic());
            act(() => result.current.vibrate(pattern));
            expect(spy).toHaveBeenCalledWith(expected);
        }
    );

    it("exposes a stable vibrate reference across renders (memoized)", () => {
        const { result, rerender } = renderHook(() => useHaptic());
        const first = result.current.vibrate;
        rerender();
        expect(result.current.vibrate).toBe(first);
    });

    it("fires once per call (no double-invoke)", () => {
        const spy = installVibrate();
        const { result } = renderHook(() => useHaptic());
        act(() => {
            result.current.vibrate("tap");
            result.current.vibrate("tap");
            result.current.vibrate("tap");
        });
        expect(spy).toHaveBeenCalledTimes(3);
    });
});
