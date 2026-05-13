import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface State {
    isModalOpened: boolean;
    /**
     * `null` when creating a new project, project id when editing an
     * existing one. Lives in Redux (not just on the URL) so the modal's
     * `open` flag flips synchronously on click — see `useProjectModal`
     * for why URL-derived state alone was unreliable on iOS Safari.
     */
    editingProjectId: string | null;
}

const initialState: State = {
    isModalOpened: false,
    editingProjectId: null
};

export const projectModalSlice = createSlice({
    name: "projectModal",
    initialState,
    reducers: {
        openModal(state) {
            state.isModalOpened = true;
        },
        closeModal(state) {
            state.isModalOpened = false;
            state.editingProjectId = null;
        },
        startEditing(state, action: PayloadAction<string>) {
            state.editingProjectId = action.payload;
            state.isModalOpened = true;
        },
        setEditingProjectId(state, action: PayloadAction<string | null>) {
            state.editingProjectId = action.payload;
            state.isModalOpened =
                state.isModalOpened || action.payload !== null;
        }
    }
});

export const projectActions = projectModalSlice.actions;
