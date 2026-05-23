import { renderHook } from "@testing-library/react";
import { act } from "react";

import useIsPhoneChrome from "./useIsPhoneChrome";

/**
 * `useIsPhoneChrome` reads `matchMedia("(pointer: coarse)")` and tracks
 * its `change` events. We swap `window.matchMedia` for a configurable
 * stub between tests so the hook flips between desktop and phone modes
 * without dragging in real CSS media-query evaluation.
 */
interface MediaQueryStub {
    matches: boolean;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    addListener: jest.Mock;
    removeListener: jest.Mock;
    media: string;
    onchange: null;
    dispatchEvent: jest.Mock;
}

const installMatchMedia = (matches: boolean) => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const stub: MediaQueryStub = {
        matches,
        addEventListener: jest.fn((_event: string, handler: unknown) => {
            listeners.push(handler as (event: MediaQueryListEvent) => void);
        }),
        removeEventListener: jest.fn((_event: string, handler: unknown) => {
            const idx = listeners.indexOf(
                handler as (event: MediaQueryListEvent) => void
            );
            if (idx >= 0) listeners.splice(idx, 1);
        }),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        media: "(pointer: coarse)",
        onchange: null,
        dispatchEvent: jest.fn()
    };
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: () => stub
    });
    return {
        stub,
        emit: (next: boolean) => {
            stub.matches = next;
            const event = { matches: next } as MediaQueryListEvent;
            listeners.slice().forEach((handler) => handler(event));
        }
    };
};

describe("useIsPhoneChrome", () => {
    it("returns false when the pointer is fine (desktop / mouse)", () => {
        installMatchMedia(false);
        const { result } = renderHook(() => useIsPhoneChrome());
        expect(result.current).toBe(false);
    });

    it("returns true when the pointer is coarse (phone / touchscreen)", () => {
        installMatchMedia(true);
        const { result } = renderHook(() => useIsPhoneChrome());
        expect(result.current).toBe(true);
    });

    it("re-renders when the matchMedia change event fires", () => {
        const { emit } = installMatchMedia(false);
        const { result } = renderHook(() => useIsPhoneChrome());
        expect(result.current).toBe(false);

        act(() => {
            emit(true);
        });

        expect(result.current).toBe(true);
    });

    it("unsubscribes from matchMedia on unmount", () => {
        const { stub } = installMatchMedia(true);
        const { unmount } = renderHook(() => useIsPhoneChrome());
        expect(stub.addEventListener).toHaveBeenCalledTimes(1);

        unmount();

        expect(stub.removeEventListener).toHaveBeenCalledTimes(1);
    });
});
