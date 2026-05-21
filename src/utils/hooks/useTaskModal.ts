import { overlaysActions } from "../../store/reducers/overlaysSlice";

import createOverlayHook from "./_createOverlayHook";

/**
 * Open/close + editing-id state for the task modal. See
 * `_createOverlayHook` for the iOS Safari + cross-subtree-propagation
 * rationale shared by the whole overlay family.
 */
const useTaskModalBase = createOverlayHook<string | null, string>({
    select: (s) => s.overlays.editingTaskId,
    openAction: overlaysActions.startEditingTask,
    closeAction: overlaysActions.closeTaskModal
});

const useTaskModal = () => {
    const { value, open, close } = useTaskModalBase();
    return {
        editingTaskId: value,
        startEditing: open,
        closeModal: close
    };
};

export default useTaskModal;
