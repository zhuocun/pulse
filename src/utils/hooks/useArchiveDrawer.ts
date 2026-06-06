import { overlaysActions } from "../../store/reducers/overlaysSlice";

import createOverlayHook from "./_createOverlayHook";

/**
 * Open/close state for the board Archive drawer (work-management-depth
 * §5.4/§5.6 — the read-only list of archived tasks with archive/unarchive
 * recovery + permanent-Delete actions). See `_createOverlayHook` for the
 * iOS Safari + cross-subtree-propagation rationale shared by the whole
 * overlay family. Mirrors `useTrashDrawer` exactly — a single boolean flag.
 */
const useArchiveDrawerBase = createOverlayHook<boolean>({
    select: (s) => s.overlays.archiveDrawerOpen,
    openAction: overlaysActions.openArchiveDrawer,
    closeAction: overlaysActions.closeArchiveDrawer
});

const useArchiveDrawer = () => {
    const { value, open, close } = useArchiveDrawerBase();
    return { open: value, openDrawer: open, closeDrawer: close };
};

export default useArchiveDrawer;
