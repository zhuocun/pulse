import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import useTrashDrawer from "./useTrashDrawer";

const Probe = () => {
    const { open, openDrawer, closeDrawer } = useTrashDrawer();
    return (
        <div>
            <span data-testid="open">{open ? "open" : "closed"}</span>
            <button type="button" onClick={openDrawer}>
                open
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

describe("useTrashDrawer (Redux-only)", () => {
    beforeEach(() => {
        store.dispatch(overlaysActions.closeTrashDrawer());
    });
    afterEach(() => {
        store.dispatch(overlaysActions.closeTrashDrawer());
    });

    it("starts closed", () => {
        renderProbe();
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
    });

    it("openDrawer flips to open", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open" }));
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        expect(store.getState().overlays.trashDrawerOpen).toBe(true);
    });

    it("closeDrawer flips to closed", () => {
        act(() => {
            store.dispatch(overlaysActions.openTrashDrawer());
        });
        renderProbe();
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        fireEvent.click(screen.getByRole("button", { name: "close" }));
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
        expect(store.getState().overlays.trashDrawerOpen).toBe(false);
    });

    it("reflects external dispatches in the consumer hook", () => {
        renderProbe();
        act(() => {
            store.dispatch(overlaysActions.openTrashDrawer());
        });
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        act(() => {
            store.dispatch(overlaysActions.closeTrashDrawer());
        });
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
    });
});
