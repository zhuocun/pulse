import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { message } from "antd";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";

import useUndoToast from "./useUndoToast";

jest.mock("../../constants/analytics", () => ({
    __esModule: true,
    ANALYTICS_EVENTS: {
        UNDO_APPLIED: "undo.applied"
    },
    track: jest.fn()
}));

const trackMock = track as jest.MockedFunction<typeof track>;

const undoButton = async (): Promise<HTMLElement> => {
    return waitFor(() => {
        const buttons = Array.from(
            document.querySelectorAll<HTMLButtonElement>(
                ".ant-message-notice button"
            )
        );
        const found = buttons.find(
            (b) => b.textContent === microcopy.ai.undoLabel
        );
        if (!found) {
            throw new Error("Undo button not yet mounted");
        }
        return found;
    });
};

describe("useUndoToast", () => {
    afterEach(async () => {
        act(() => {
            message.destroy();
        });
        // Drain AntD's microtask queue so the next test starts with a clean
        // notification surface.
        await act(async () => {
            await Promise.resolve();
        });
        trackMock.mockClear();
    });

    it("renders the toast description and an Undo button", async () => {
        const { result } = renderHook(() => useUndoToast());
        act(() => {
            result.current.show({
                description: "Estimate applied to 3 tasks.",
                undo: jest.fn()
            });
        });
        const button = await undoButton();
        expect(button.textContent).toBe(microcopy.ai.undoLabel);
        expect(document.body.textContent).toContain(
            "Estimate applied to 3 tasks."
        );
    });

    it("invokes the undo callback once and tracks the analytics event", async () => {
        const undo = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useUndoToast());
        act(() => {
            result.current.show({
                description: "Estimate applied.",
                undo,
                analyticsTag: "copilot.estimate.apply"
            });
        });
        const button = await undoButton();
        await act(async () => {
            fireEvent.click(button);
        });
        expect(undo).toHaveBeenCalledTimes(1);
        expect(trackMock).toHaveBeenCalledWith(ANALYTICS_EVENTS.UNDO_APPLIED, {
            surface: "copilot.estimate.apply"
        });
    });

    it("ignores repeated Undo clicks after the first", async () => {
        const undo = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useUndoToast());
        act(() => {
            result.current.show({
                description: "Mutation applied.",
                undo
            });
        });
        const button = await undoButton();
        await act(async () => {
            fireEvent.click(button);
            fireEvent.click(button);
            fireEvent.click(button);
        });
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it("shows the operationFailed error toast when undo rejects", async () => {
        const undo = jest.fn().mockRejectedValue(new Error("server died"));
        const { result } = renderHook(() => useUndoToast());
        act(() => {
            result.current.show({
                description: "Estimate applied.",
                undo
            });
        });
        const button = await undoButton();
        await act(async () => {
            fireEvent.click(button);
        });
        await waitFor(() => {
            expect(document.body.textContent).toContain(
                microcopy.feedback.operationFailed
            );
        });
    });

    it("dismiss() removes the toast", async () => {
        const { result } = renderHook(() => useUndoToast());
        let ret: { dismiss: () => void } | null = null;
        act(() => {
            ret = result.current.show({
                description: "Will be dismissed.",
                undo: jest.fn()
            });
        });
        await waitFor(() => {
            expect(document.body.textContent).toContain("Will be dismissed.");
        });
        act(() => {
            ret?.dismiss();
        });
        await waitFor(() => {
            expect(document.body.textContent).not.toContain(
                "Will be dismissed."
            );
        });
    });
});
