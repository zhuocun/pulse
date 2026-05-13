import { projectActions, projectModalSlice } from "./projectModalSlice";

describe("projectModalSlice", () => {
    it("returns the closed initial state", () => {
        expect(
            projectModalSlice.reducer(undefined, { type: "unknown" })
        ).toEqual({
            isModalOpened: false,
            editingProjectId: null
        });
    });

    it("opens the modal", () => {
        expect(
            projectModalSlice.reducer(undefined, projectActions.openModal())
        ).toEqual({
            isModalOpened: true,
            editingProjectId: null
        });
    });

    it("closes the modal and clears editingProjectId", () => {
        const openState = { isModalOpened: true, editingProjectId: "p1" };

        expect(
            projectModalSlice.reducer(openState, projectActions.closeModal())
        ).toEqual({
            isModalOpened: false,
            editingProjectId: null
        });
    });

    it("startEditing sets editingProjectId and opens", () => {
        expect(
            projectModalSlice.reducer(
                undefined,
                projectActions.startEditing("p1")
            )
        ).toEqual({
            isModalOpened: true,
            editingProjectId: "p1"
        });
    });

    it("setEditingProjectId without an open state opens the modal", () => {
        expect(
            projectModalSlice.reducer(
                undefined,
                projectActions.setEditingProjectId("p2")
            )
        ).toEqual({
            isModalOpened: true,
            editingProjectId: "p2"
        });
    });

    it("setEditingProjectId(null) preserves an explicitly opened modal", () => {
        const state = { isModalOpened: true, editingProjectId: "p1" };
        expect(
            projectModalSlice.reducer(
                state,
                projectActions.setEditingProjectId(null)
            )
        ).toEqual({
            isModalOpened: true,
            editingProjectId: null
        });
    });
});
