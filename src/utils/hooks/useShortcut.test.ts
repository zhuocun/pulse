import { act, renderHook } from "@testing-library/react";

import type { ShortcutSegment } from "../../constants/shortcuts";

import useShortcut from "./useShortcut";

/** Dispatch a keydown on a given target (defaults to document.body). */
const press = (
    init: KeyboardEventInit,
    target: EventTarget = document.body
): void => {
    act(() => {
        const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ...init
        });
        target.dispatchEvent(event);
    });
};

const singleChord: readonly ShortcutSegment[] = [[{ key: "?" }]];
const modChord: readonly ShortcutSegment[] = [[{ mod: true, key: "k" }]];
const sequence: readonly ShortcutSegment[] = [[{ key: "g" }], [{ key: "p" }]];

describe("useShortcut", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it("fires on a simple single-key combo", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(singleChord, handler));
        press({ key: "?" });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("fires on a platform modifier combo (ctrl on non-mac jsdom)", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(modChord, handler));
        // jsdom's navigator is not mac-like, so ctrl is the modifier.
        press({ key: "k", ctrlKey: true });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does not fire a non-mod single key when the command modifier is held", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut([[{ key: "c" }]], handler));
        press({ key: "c", ctrlKey: true });
        expect(handler).not.toHaveBeenCalled();
        press({ key: "c" });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("fires a chord sequence (g then p)", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(sequence, handler));
        press({ key: "g" });
        expect(handler).not.toHaveBeenCalled();
        press({ key: "p" });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("resets a sequence after the timeout so g … (wait) … p does NOT fire", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(sequence, handler));
        press({ key: "g" });
        act(() => {
            jest.advanceTimersByTime(1100);
        });
        press({ key: "p" });
        expect(handler).not.toHaveBeenCalled();
    });

    it("restarts the sequence when the first key is pressed again", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(sequence, handler));
        press({ key: "x" }); // noise
        press({ key: "g" });
        press({ key: "g" }); // restart, still at progress 1
        press({ key: "p" });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("ignores events originating from text inputs", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(singleChord, handler));
        const input = document.createElement("input");
        document.body.appendChild(input);
        press({ key: "?" }, input);
        expect(handler).not.toHaveBeenCalled();
        input.remove();
    });

    it("ignores events from textarea and contentEditable", () => {
        const handler = jest.fn();
        renderHook(() => useShortcut(singleChord, handler));

        const textarea = document.createElement("textarea");
        document.body.appendChild(textarea);
        press({ key: "?" }, textarea);

        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "true");
        Object.defineProperty(editable, "isContentEditable", { value: true });
        document.body.appendChild(editable);
        press({ key: "?" }, editable);

        expect(handler).not.toHaveBeenCalled();
        textarea.remove();
        editable.remove();
    });

    it("respects the enabled flag", () => {
        const handler = jest.fn();
        const { rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) =>
                useShortcut(singleChord, handler, { enabled }),
            { initialProps: { enabled: false } }
        );
        press({ key: "?" });
        expect(handler).not.toHaveBeenCalled();
        rerender({ enabled: true });
        press({ key: "?" });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("removes its listener on unmount", () => {
        const handler = jest.fn();
        const { unmount } = renderHook(() => useShortcut(singleChord, handler));
        unmount();
        press({ key: "?" });
        expect(handler).not.toHaveBeenCalled();
    });

    it("calls the latest handler without re-binding", () => {
        const first = jest.fn();
        const second = jest.fn();
        const { rerender } = renderHook(
            ({ handler }: { handler: () => void }) =>
                useShortcut(singleChord, handler),
            { initialProps: { handler: first } }
        );
        rerender({ handler: second });
        press({ key: "?" });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
