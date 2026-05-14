import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import useAiChatDrawer from "./useAiChatDrawer";

const Probe = () => {
    const { open, openDrawer, closeDrawer, pendingPrompt } = useAiChatDrawer();
    return (
        <div>
            <span data-testid="open">{open ? "open" : "closed"}</span>
            <span data-testid="prompt">{pendingPrompt ?? "no-prompt"}</span>
            <button type="button" onClick={() => openDrawer()}>
                open-no-prompt
            </button>
            <button type="button" onClick={() => openDrawer("Summarize")}>
                open-prompt
            </button>
            <button type="button" onClick={closeDrawer}>
                close
            </button>
        </div>
    );
};

const renderProbe = () =>
    render(
        <Provider store={store}>
            <MemoryRouter>
                <Probe />
            </MemoryRouter>
        </Provider>
    );

describe("useAiChatDrawer (Redux-only)", () => {
    beforeEach(() => {
        store.dispatch(overlaysActions.closeChatDrawer());
    });
    afterEach(() => {
        store.dispatch(overlaysActions.closeChatDrawer());
    });

    it("starts closed with no pending prompt", () => {
        renderProbe();
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
        expect(screen.getByTestId("prompt")).toHaveTextContent("no-prompt");
    });

    it("openDrawer() with no argument flips the open flag without setting a prompt", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open-no-prompt" }));
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        expect(screen.getByTestId("prompt")).toHaveTextContent("no-prompt");
        expect(store.getState().overlays.chatDrawer).toEqual({
            open: true,
            pendingPrompt: null
        });
    });

    it("openDrawer(prompt) seeds the pendingPrompt", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open-prompt" }));
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        expect(screen.getByTestId("prompt")).toHaveTextContent("Summarize");
    });

    it("closeDrawer clears the open flag and pendingPrompt", () => {
        act(() => {
            store.dispatch(
                overlaysActions.openChatDrawer({ pendingPrompt: "hi" })
            );
        });
        renderProbe();
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        fireEvent.click(screen.getByRole("button", { name: "close" }));
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
        expect(screen.getByTestId("prompt")).toHaveTextContent("no-prompt");
    });

    it("reflects external dispatches synchronously", () => {
        renderProbe();
        act(() => {
            store.dispatch(
                overlaysActions.openChatDrawer({ pendingPrompt: "outside" })
            );
        });
        // After an external dispatch the consumer renders the same hook
        // state we observed via the action: see useSyncExternalStore.
        expect(screen.getByTestId("prompt")).toHaveTextContent("outside");
    });
});
