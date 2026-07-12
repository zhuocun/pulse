import {
    act,
    fireEvent,
    render,
    renderHook,
    screen,
    waitFor
} from "@testing-library/react";

import { message, type OpenArgs } from "@/components/ui/toast";

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

/*
 * The Undo toast now routes through the sonner-backed `message` module
 * (`@/components/ui/toast`) instead of AntD's global message container.
 * We spy on the `message` API and render the ReactNode handed to
 * `message.open` in isolation to drive the Undo button — deterministic
 * without mounting a `<Toaster>` (sonner's portal + exit animations are
 * fiddly to script in jsdom).
 */
describe("useUndoToast", () => {
    let openSpy: jest.SpyInstance;
    let successSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    let destroySpy: jest.SpyInstance;

    beforeEach(() => {
        openSpy = jest.spyOn(message, "open");
        successSpy = jest.spyOn(message, "success");
        errorSpy = jest.spyOn(message, "error");
        destroySpy = jest.spyOn(message, "destroy");
    });

    afterEach(() => {
        jest.restoreAllMocks();
        trackMock.mockClear();
    });

    const lastOpenArgs = (): OpenArgs => {
        const call = openSpy.mock.calls.at(-1);
        if (!call) throw new Error("message.open was not called");
        return call[0] as OpenArgs;
    };

    const renderLastToast = () => render(<>{lastOpenArgs().content}</>);

    it("renders the toast description and an Undo button", () => {
        const { result } = renderHook(() => useUndoToast());
        act(() => {
            result.current.show({
                description: "Estimate applied to 3 tasks.",
                undo: jest.fn()
            });
        });
        expect(openSpy).toHaveBeenCalledTimes(1);
        renderLastToast();
        expect(
            screen.getByRole("button", { name: microcopy.ai.undoLabel })
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Estimate applied to 3 tasks\./)
        ).toBeInTheDocument();
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
        renderLastToast();
        const button = screen.getByRole("button", {
            name: microcopy.ai.undoLabel
        });
        await act(async () => {
            fireEvent.click(button);
        });
        expect(undo).toHaveBeenCalledTimes(1);
        expect(trackMock).toHaveBeenCalledWith(ANALYTICS_EVENTS.UNDO_APPLIED, {
            surface: "copilot.estimate.apply"
        });
        expect(successSpy).toHaveBeenCalledWith(
            microcopy.mutation.undoApplied,
            1.5
        );
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
        renderLastToast();
        const button = screen.getByRole("button", {
            name: microcopy.ai.undoLabel
        });
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
        renderLastToast();
        const button = screen.getByRole("button", {
            name: microcopy.ai.undoLabel
        });
        await act(async () => {
            fireEvent.click(button);
        });
        await waitFor(() =>
            expect(errorSpy).toHaveBeenCalledWith(
                microcopy.feedback.operationFailed,
                2
            )
        );
    });

    it("dismiss() removes the toast", () => {
        const { result } = renderHook(() => useUndoToast());
        let ret: { dismiss: () => void } | null = null;
        act(() => {
            ret = result.current.show({
                description: "Will be dismissed.",
                undo: jest.fn()
            });
        });
        const { key } = lastOpenArgs();
        act(() => {
            ret?.dismiss();
        });
        expect(destroySpy).toHaveBeenCalledWith(key);
    });
});
