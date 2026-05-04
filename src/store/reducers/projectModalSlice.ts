import { createSlice } from "@reduxjs/toolkit";

interface State {
    isModalOpened: boolean;
}

const initialState: State = {
    isModalOpened: false
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
        }
    }
});

export const projectActions = projectModalSlice.actions;
