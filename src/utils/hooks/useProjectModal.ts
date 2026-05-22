import { useCallback } from "react";

import { projectActions } from "../../store/reducers/projectModalSlice";

import createOverlayHook from "./_createOverlayHook";
import useReactQuery from "./useReactQuery";
import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Project-modal open/close + editing-id state, plus the React Query
 * hydration for the project being edited. See `_createOverlayHook` for
 * the iOS Safari + cross-subtree-propagation rationale shared by the
 * whole overlay family — `useProjectModal` was the first to migrate
 * (see PR #226), and the rest now follow the same pattern.
 *
 * Trade-off accepted: deep links to `?modal=on` and the back-button
 * gesture no longer auto-open the modal.
 */
const useProjectModalBase = createOverlayHook<boolean>({
    select: (s) => s.projectModal.isModalOpened,
    openAction: projectActions.openModal,
    closeAction: projectActions.closeModal
});

const useProjectModal = () => {
    const dispatch = useReduxDispatch();
    const {
        value: isModalOpened,
        open: openModal,
        close: closeModal
    } = useProjectModalBase();
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
     *
     * Without an ``editingProjectId`` the read collides with the list
     * page's ``["projects", {}]`` cache entry (``filterRequest`` strips
     * ``projectId: undefined``) and ``data`` arrives as the full project
     * list — flipping ``isEditing`` true on the "Create project" CTA and
     * shipping a modal titled "Edit project". Discard the colliding read
     * here so callers only ever see a single ``IProject`` or
     * ``undefined``.
     */
    const isEditing = Boolean(editingProjectId);
    const { data: queryData, isLoading: queryLoading } =
        useReactQuery<IProject>(
            "projects",
            { projectId: editingProjectId },
            undefined,
            undefined,
            undefined,
            isEditing
        );
    const editingProject = isEditing ? queryData : undefined;
    const isLoading = isEditing && queryLoading;

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
