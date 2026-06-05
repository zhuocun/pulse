import { overlaysActions } from "../../store/reducers/overlaysSlice";

import createOverlayHook from "./_createOverlayHook";

/**
 * Open/close state for the board Trash drawer (work-management-depth
 * §5.4/§5.6 — the read-only list of soft-deleted tasks with Restore /
 * permanent-Delete actions). See `_createOverlayHook` for the iOS Safari
 * + cross-subtree-propagation rationale shared by the whole overlay
 * family. Mirrors `useBoardBriefDrawer` exactly — a single boolean flag.
 */
const useTrashDrawerBase = createOverlayHook<boolean>({
    select: (s) => s.overlays.trashDrawerOpen,
    openAction: overlaysActions.openTrashDrawer,
    closeAction: overlaysActions.closeTrashDrawer
});

const useTrashDrawer = () => {
    const { value, open, close } = useTrashDrawerBase();
    return { open: value, openDrawer: open, closeDrawer: close };
};

export default useTrashDrawer;
