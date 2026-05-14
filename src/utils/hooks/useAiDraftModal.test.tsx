import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import useAiDraftModal from "./useAiDraftModal";

const Probe = () => {
    const { activeColumnId, openModal, closeModal } = useAiDraftModal();
    return (
        <div>
            <span data-testid="active">{activeColumnId ?? "none"}</span>
            <button type="button" onClick={() => openModal("col-1")}>
                open-col-1
            </button>
            <button type="button" onClick={() => openModal("col-2")}>
                open-col-2
            </button>
            <button type="button" onClick={closeModal}>
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

describe("useAiDraftModal (Redux-only)", () => {
    beforeEach(() => {
        store.dispatch(overlaysActions.closeAiDraft());
    });
    afterEach(() => {
        store.dispatch(overlaysActions.closeAiDraft());
    });

    it("starts with no active column id", () => {
        renderProbe();
        expect(screen.getByTestId("active")).toHaveTextContent("none");
    });

    it("openModal sets the active column id", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open-col-1" }));
        expect(screen.getByTestId("active")).toHaveTextContent("col-1");
        expect(store.getState().overlays.aiDraftActiveColumnId).toBe("col-1");
    });

    it("re-opening with a different column id replaces the active column", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open-col-1" }));
        fireEvent.click(screen.getByRole("button", { name: "open-col-2" }));
        expect(screen.getByTestId("active")).toHaveTextContent("col-2");
    });

    it("closeModal clears the active column id", () => {
        renderProbe();
        fireEvent.click(screen.getByRole("button", { name: "open-col-1" }));
        fireEvent.click(screen.getByRole("button", { name: "close" }));
        expect(screen.getByTestId("active")).toHaveTextContent("none");
        expect(store.getState().overlays.aiDraftActiveColumnId).toBeNull();
    });
});
