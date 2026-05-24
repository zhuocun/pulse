import { act, renderHook } from "@testing-library/react";

import useKeyboardOpen from "./useKeyboardOpen";

/*
 * Phase 6 Wave 1 — `useKeyboardOpen` is the extracted single source of
 * truth for "is the soft keyboard raised". The tests below cover the
 * four canonical states (closed / shrunk-only / focused-only / both)
 * plus the SSR fallback. They follow the same visualViewport-mocking
 * pattern as `bottomTabBar/index.test.tsx` so the hook's behaviour
 * stays in lockstep with its first consumer.
 */

interface MockVisualViewport {
    height: number;
    width: number;
    addEventListener: (event: string, cb: () => void) => void;
    removeEventListener: jest.Mock;
}

const setupViewport = (
    initialHeight = 700,
    innerHeight = 700
): {
    vv: MockVisualViewport;
    listeners: Array<() => void>;
    fireResize: () => void;
} => {
    const listeners: Array<() => void> = [];
    const vv: MockVisualViewport = {
        height: initialHeight,
        width: 375,
        addEventListener: (event: string, cb: () => void) => {
            if (event === "resize" || event === "scroll") listeners.push(cb);
        },
        removeEventListener: jest.fn()
    };
    Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: vv
    });
    Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: innerHeight
    });
    return {
        vv,
        listeners,
        fireResize: () => {
            act(() => {
                listeners.forEach((cb) => cb());
            });
        }
    };
};

describe("useKeyboardOpen", () => {
    afterEach(() => {
        // JSDOM doesn't ship visualViewport by default. The cast widens
        // window to an interface that allows deletion of the optional
        // property so the next test starts from a clean slate.
        delete (window as { visualViewport?: VisualViewport }).visualViewport;
        // Clean up any focused inputs the tests appended to the body.
        document.body.innerHTML = "";
    });

    it("returns false when visualViewport is undefined (SSR / Safari < 14 fallback)", () => {
        // No viewport API → we can't detect the keyboard. The hook
        // must default to closed so the bar / sheet stays visible
        // rather than disappearing under a wrong guess.
        const { result } = renderHook(() => useKeyboardOpen());
        expect(result.current).toBe(false);
    });

    it("returns false when the viewport is tall and no input is focused (resting state)", () => {
        setupViewport(700, 700);
        const { result } = renderHook(() => useKeyboardOpen());
        expect(result.current).toBe(false);
    });

    it("returns false when the viewport shrinks but no input is focused (URL-bar collapse, not keyboard)", () => {
        // Chrome Android collapses the URL bar on scroll, shrinking
        // visualViewport by ~56–100 px. Without an input focused this
        // is not the keyboard — the hook must keep returning false so
        // the BottomTabBar stays visible.
        const { fireResize, vv } = setupViewport(700, 700);
        const { result } = renderHook(() => useKeyboardOpen());
        vv.height = 600;
        fireResize();
        expect(result.current).toBe(false);
    });

    it("returns false when an input is focused but the viewport is still tall (focus without keyboard)", () => {
        // Edge case: a user can programmatically focus an input
        // without raising the keyboard (e.g. via .focus() before the
        // user has tapped the screen on mobile). Without the
        // viewport shrink, the predicate must stay false.
        setupViewport(700, 700);
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        const { result } = renderHook(() => useKeyboardOpen());
        expect(result.current).toBe(false);
    });

    it("returns true when the viewport shrinks below the 0.75 ratio AND an input is focused", () => {
        // The canonical keyboard-open state: visualViewport shrunk
        // below 75% of the document innerHeight, with a text input
        // focused. 300 / 700 ≈ 0.43 < 0.75.
        const { fireResize, vv } = setupViewport(700, 700);
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        const { result } = renderHook(() => useKeyboardOpen());
        vv.height = 300;
        fireResize();
        expect(result.current).toBe(true);
    });

    it("re-resolves to false when the keyboard dismisses (viewport restores)", () => {
        const { fireResize, vv } = setupViewport(700, 700);
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        const { result } = renderHook(() => useKeyboardOpen());
        vv.height = 300;
        fireResize();
        expect(result.current).toBe(true);
        // Keyboard dismisses → viewport restores. The hook must flip
        // back to false on the next resize tick.
        vv.height = 700;
        fireResize();
        expect(result.current).toBe(false);
    });

    it("treats a textarea focus the same as an input focus", () => {
        // `HTMLTextAreaElement` is the second canonical text-entry
        // surface. The predicate must light up for both — otherwise
        // a multi-line comment field would leave the bottom-tab bar
        // visible behind the keyboard.
        const { fireResize, vv } = setupViewport(700, 700);
        const textarea = document.createElement("textarea");
        document.body.appendChild(textarea);
        textarea.focus();
        const { result } = renderHook(() => useKeyboardOpen());
        vv.height = 300;
        fireResize();
        expect(result.current).toBe(true);
    });

    it("re-evaluates on focusin when focus moves between inputs with the keyboard already up", () => {
        // Common case: the user taps from one input to another while
        // the keyboard stays up. visualViewport doesn't fire a delta
        // (the viewport stayed the same shrunken size), but the hook
        // listens to `focusin` too so the predicate stays correct.
        const { fireResize, vv } = setupViewport(700, 700);
        const inputA = document.createElement("input");
        const inputB = document.createElement("input");
        document.body.appendChild(inputA);
        document.body.appendChild(inputB);
        inputA.focus();
        const { result } = renderHook(() => useKeyboardOpen());
        vv.height = 300;
        fireResize();
        expect(result.current).toBe(true);
        // Move focus to the second input while the keyboard remains
        // up. The hook should re-evaluate to true again (no flicker).
        act(() => {
            inputB.focus();
        });
        expect(result.current).toBe(true);
        // Blur to a non-input (the body) while the viewport is still
        // shrunk → the input-focused gate flips and the predicate
        // returns false even though the visualViewport hasn't changed.
        act(() => {
            inputB.blur();
            (document.body as HTMLElement).focus();
        });
        expect(result.current).toBe(false);
    });

    it("cleans up the visualViewport + focusin listeners on unmount", () => {
        const { vv } = setupViewport(700, 700);
        const { unmount } = renderHook(() => useKeyboardOpen());
        unmount();
        // The hook installs two visualViewport listeners (resize +
        // scroll) and two document listeners (focusin + focusout).
        // We assert the visualViewport.removeEventListener calls
        // here; the document listener cleanup is implicit (jsdom's
        // document mock tracks listeners by reference, so a missing
        // remove would leak into the next test's body but is harder
        // to assert directly).
        expect(vv.removeEventListener).toHaveBeenCalledWith(
            "resize",
            expect.any(Function)
        );
        expect(vv.removeEventListener).toHaveBeenCalledWith(
            "scroll",
            expect.any(Function)
        );
    });
});
