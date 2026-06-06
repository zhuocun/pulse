import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import useArchiveDrawer from "./useArchiveDrawer";

const Probe = () => {
    const { open, openDrawer, closeDrawer } = useArchiveDrawer();
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

describe("useArchiveDrawer (Redux-only)", () => {
    beforeEach(() => {
        store.dispatch(overlaysActions.closeArchiveDrawer());
    });
    afterEach(() => {
        store.dispatch(overlaysActions.closeArchiveDrawer());
    });

    it("starts closed", () => {
        renderProbe();
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
    });

    it("openDrawer flips to open", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open" }));
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        expect(store.getState().overlays.archiveDrawerOpen).toBe(true);
    });

    it("closeDrawer flips to closed", () => {
        act(() => {
            store.dispatch(overlaysActions.openArchiveDrawer());
        });
        renderProbe();
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        fireEvent.click(screen.getByRole("button", { name: "close" }));
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
        expect(store.getState().overlays.archiveDrawerOpen).toBe(false);
    });

    it("reflects external dispatches in the consumer hook", () => {
        renderProbe();
        act(() => {
            store.dispatch(overlaysActions.openArchiveDrawer());
        });
        expect(screen.getByTestId("open")).toHaveTextContent("open");
        act(() => {
            store.dispatch(overlaysActions.closeArchiveDrawer());
        });
        expect(screen.getByTestId("open")).toHaveTextContent("closed");
    });
});
