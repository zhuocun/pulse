import { useCallback } from "react";

import { projectActions } from "../../store/reducers/projectModalSlice";

import useReactQuery from "./useReactQuery";
import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Project-modal open/close state — Redux only.
 *
 * Previous attempts bound `isModalOpened` to a URL search param so the
 * system back button could dismiss the overlay and deep links worked.
 * On iOS Safari WebKit, React Router's context propagation never
 * reached the modal's subtree after a `setSearchParams` write, so the
 * click updated the URL bar but the modal never opened. Three
 * intermediate fixes (local-state mirror, direct `useSearchParams`,
 * module-level pub/sub) all carried the same dependency.
 *
 * The whole modal family now lives in Redux only — `react-redux` uses
 * `useSyncExternalStore` internally and is the most reliable
 * cross-subtree subscription primitive in React. Dispatches are
 * synchronous, so the modal flips in the same render as the click.
 *
 * Trade-off accepted: deep links to `?modal=on` and the back-button
 * gesture no longer auto-open the modal. Sibling slices
 * (`useTaskModal` / `useAiChatDrawer` / `useBoardBriefDrawer` /
 * `useAiDraftModal`) follow the same pattern.
 */
const useProjectModal = () => {
    const dispatch = useReduxDispatch();
    const isModalOpened = useReduxSelector((s) => s.projectModal.isModalOpened);
    const editingProjectId = useReduxSelector(
        (s) => s.projectModal.editingProjectId
    );

    /*
     * Reuse the canonical `["projects", { projectId }]` cache key so the
     * modal hits the same entry that `pages/projectDetail.tsx` and
     * `pages/board.tsx` already populated when the user navigated to the
     * project. A separate `"editingProject"` key would have triggered a
     * duplicate `/api/v1/projects?projectId=…` fetch every time the modal
     * opened, and mutations on `["projects"]` would have left the modal
     * staring at stale data.
     */
    const { data: editingProject, isLoading } = useReactQuery<IProject>(
        "projects",
        { projectId: editingProjectId },
        undefined,
        undefined,
        undefined,
        Boolean(editingProjectId)
    );

    const openModal = useCallback(() => {
        dispatch(projectActions.openModal());
    }, [dispatch]);

    const closeModal = useCallback(() => {
        dispatch(projectActions.closeModal());
    }, [dispatch]);

    const startEditing = useCallback(
        (id: string) => {
            dispatch(projectActions.startEditing(id));
        },
        [dispatch]
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
