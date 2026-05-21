import { overlaysActions } from "../../store/reducers/overlaysSlice";

import createOverlayHook from "./_createOverlayHook";

/**
 * Open/close state for the Board Brief drawer. See `_createOverlayHook`
 * for the iOS Safari + cross-subtree-propagation rationale shared by
 * the whole overlay family.
 */
const useBoardBriefDrawerBase = createOverlayHook<boolean>({
    select: (s) => s.overlays.boardBriefOpen,
    openAction: overlaysActions.openBoardBrief,
    closeAction: overlaysActions.closeBoardBrief
});

const useBoardBriefDrawer = () => {
    const { value, open, close } = useBoardBriefDrawerBase();
    return { open: value, openDrawer: open, closeDrawer: close };
};

export default useBoardBriefDrawer;
