import { overlaysActions } from "../../store/reducers/overlaysSlice";

import createOverlayHook from "./_createOverlayHook";

/**
 * Open/close + active-column-id state for the AI Task Draft modal.
 * Multiple per-column triggers coexist: each `TaskCreator` only renders
 * the modal when `activeColumnId === its columnId`. See
 * `_createOverlayHook` for the iOS Safari + cross-subtree-propagation
 * rationale shared by the whole overlay family.
 */
const useAiDraftModalBase = createOverlayHook<string | null, string>({
    select: (s) => s.overlays.aiDraftActiveColumnId,
    openAction: overlaysActions.openAiDraft,
    closeAction: overlaysActions.closeAiDraft
});

const useAiDraftModal = () => {
    const { value, open, close } = useAiDraftModalBase();
    return {
        activeColumnId: value ?? undefined,
        openModal: open,
        closeModal: close
    };
};

export default useAiDraftModal;
