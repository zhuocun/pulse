import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import { projectActions } from "../../store/reducers/projectModalSlice";

import useReactQuery from "./useReactQuery";
import { useReduxDispatch, useReduxSelector } from "./useRedux";
import useUrl from "./useUrl";

/**
 * Project-modal open/close state.
 *
 * Why Redux is the source of truth, not the URL:
 *
 * Earlier versions of this hook drove `isModalOpened` from `useUrl`
 * (and later `useSearchParams`) and treated the URL as the binding
 * source. On iOS Safari WebKit the click reached `setSearchParams` —
 * the URL bar updated, refreshing the page brought the modal up — but
 * the React Router subscription that the modal subtree was listening
 * on never fired a re-render. The Create-project click looked
 * silently broken, and the same path blocked the X-to-close.
 *
 * To bind the modal to a propagation mechanism that does not depend on
 * Router context, we now keep both `isModalOpened` and
 * `editingProjectId` in Redux. `react-redux` uses
 * `useSyncExternalStore` internally, which is the most reliable
 * cross-subtree subscription primitive in React.
 *
 * The URL is still written on every state change so deep links, the
 * system back button, and refresh continue to land in the right
 * state. A reconcile effect treats the URL as authoritative on first
 * mount and whenever it changes from outside the hook (back / forward /
 * native gestures), syncing Redux to match.
 */
const useProjectModal = () => {
    const dispatch = useReduxDispatch();
    const isModalOpened = useReduxSelector((s) => s.projectModal.isModalOpened);
    const editingProjectId = useReduxSelector(
        (s) => s.projectModal.editingProjectId
    );
    const [searchParams] = useSearchParams();
    const [, setUrl] = useUrl(["modal", "editingProjectId"]);

    const urlModal = searchParams.get("modal");
    const urlEditingId = searchParams.get("editingProjectId");
    /*
     * URL → Redux reconcile. Fires on mount (so deep links and refresh
     * land in the right state) and whenever the URL changes from
     * outside this hook. Does not fight the synchronous Redux
     * dispatches inside `openModal` / `closeModal` / `startEditing`,
     * because those run *before* the matching `setUrl` and the next
     * effect tick sees Redux already in sync with the URL.
     */
    useEffect(() => {
        const shouldOpen =
            urlModal === "on" || (urlEditingId !== null && urlEditingId !== "");
        if (shouldOpen && !isModalOpened) {
            dispatch(projectActions.openModal());
        } else if (!shouldOpen && isModalOpened) {
            dispatch(projectActions.closeModal());
        }
        if ((urlEditingId ?? null) !== editingProjectId) {
            dispatch(projectActions.setEditingProjectId(urlEditingId ?? null));
        }
    }, [urlModal, urlEditingId, isModalOpened, editingProjectId, dispatch]);

    const { data: editingProject, isLoading } = useReactQuery<IProject>(
        "projects",
        { projectId: editingProjectId },
        "editingProject",
        undefined,
        undefined,
        Boolean(editingProjectId)
    );

    const openModal = useCallback(() => {
        dispatch(projectActions.openModal());
        setUrl({ modal: "on" });
    }, [dispatch, setUrl]);

    const closeModal = useCallback(() => {
        dispatch(projectActions.closeModal());
        setUrl({ modal: undefined, editingProjectId: undefined });
    }, [dispatch, setUrl]);

    const startEditing = useCallback(
        (id: string) => {
            dispatch(projectActions.startEditing(id));
            setUrl({ editingProjectId: id });
        },
        [dispatch, setUrl]
    );

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
