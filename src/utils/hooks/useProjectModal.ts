import { useEffect } from "react";

import { projectActions } from "../../store/reducers/projectModalSlice";

import useReactQuery from "./useReactQuery";
import { useReduxDispatch } from "./useRedux";
import useUrl from "./useUrl";

const useProjectModal = () => {
    const dispatch = useReduxDispatch();
    // Use a single useUrl so closeModal can clear both keys atomically. Two
    // separate setSearchParams calls would each close over the same URL
    // snapshot and the second would clobber the first.
    const [{ modal, editingProjectId }, setUrl] = useUrl([
        "modal",
        "editingProjectId"
    ]);
    const { data: editingProject, isLoading } = useReactQuery<IProject>(
        "projects",
        { projectId: editingProjectId },
        "editingProject",
        undefined,
        undefined,
        Boolean(editingProjectId)
    );
    /*
     * Derive open-state from the URL directly. The previous version stored
     * the same boolean in Redux and updated it from a useEffect, which
     * inserted a render tick between the click and the modal becoming
     * `open` — long enough on slower devices that users perceived the
     * click as a no-op and only saw the modal after refreshing (when the
     * URL is read synchronously on first mount). Reading the URL here
     * means the click and the modal-open render are the same pass.
     */
    const isModalOpened = modal === "on" || Boolean(editingProjectId);
    const openModal = () => {
        setUrl({ modal: "on" });
    };
    const closeModal = () => {
        setUrl({ modal: undefined, editingProjectId: undefined });
    };
    const startEditing = (id: string) => {
        setUrl({ editingProjectId: id });
    };

    /*
     * Mirror the URL-derived flag into Redux so any other consumer
     * (selectors in tests, future code, the existing `projectModalSlice`
     * unit tests) still sees a consistent value. This effect is no longer
     * on the critical path for the modal opening — it's a write-through
     * for downstream subscribers.
     */
    useEffect(() => {
        if (isModalOpened) {
            dispatch(projectActions.openModal());
        } else {
            dispatch(projectActions.closeModal());
        }
    }, [dispatch, isModalOpened]);

    return {
        isModalOpened,
        openModal,
        closeModal,
        startEditing,
        editingProject,
        isLoading
    };
};

export default useProjectModal;
