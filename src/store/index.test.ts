import { store } from "./index";
import { projectActions } from "./reducers/projectModalSlice";

describe("store", () => {
    beforeEach(() => {
        store.dispatch(projectActions.closeModal());
    });

    afterEach(() => {
        store.dispatch(projectActions.closeModal());
    });

    it("contains the project modal reducer state", () => {
        expect(store.getState().projectModal).toEqual({
            isModalOpened: false
        });
    });

    it("updates typed root state when project modal actions are dispatched", () => {
        store.dispatch(projectActions.openModal());

        expect(store.getState().projectModal.isModalOpened).toBe(true);

        store.dispatch(projectActions.closeModal());

        expect(store.getState().projectModal.isModalOpened).toBe(false);
    });
});
