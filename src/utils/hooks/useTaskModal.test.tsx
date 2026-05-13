import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import useTaskModal from "./useTaskModal";

const TaskModalProbe = () => {
    const { closeModal, editingTaskId, startEditing } = useTaskModal();

    return (
        <div>
            <span data-testid="editingTaskId">{editingTaskId ?? "null"}</span>
            <button type="button" onClick={() => startEditing("task-2")}>
                edit
            </button>
            <button type="button" onClick={closeModal}>
                close
            </button>
        </div>
    );
};

const renderTaskModalProbe = () =>
    render(
        <Provider store={store}>
            <MemoryRouter>
                <TaskModalProbe />
            </MemoryRouter>
        </Provider>
    );

describe("useTaskModal (Redux-only)", () => {
    beforeEach(() => {
        store.dispatch(overlaysActions.closeTaskModal());
    });

    afterEach(() => {
        store.dispatch(overlaysActions.closeTaskModal());
    });

    it("reads the editing task id from Redux", () => {
        store.dispatch(overlaysActions.startEditingTask("task-1"));
        renderTaskModalProbe();
        expect(screen.getByTestId("editingTaskId")).toHaveTextContent("task-1");
    });

    it("flips the editing task id synchronously on startEditing", () => {
        renderTaskModalProbe();

        expect(screen.getByTestId("editingTaskId")).toHaveTextContent("null");

        fireEvent.click(screen.getByRole("button", { name: "edit" }));

        expect(screen.getByTestId("editingTaskId")).toHaveTextContent("task-2");
        expect(store.getState().overlays.editingTaskId).toBe("task-2");
    });

    it("clears the editing task id on close", () => {
        store.dispatch(overlaysActions.startEditingTask("task-2"));
        renderTaskModalProbe();

        fireEvent.click(screen.getByRole("button", { name: "close" }));

        expect(screen.getByTestId("editingTaskId")).toHaveTextContent("null");
        expect(store.getState().overlays.editingTaskId).toBe(null);
    });
});
