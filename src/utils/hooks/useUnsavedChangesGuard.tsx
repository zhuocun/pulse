import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";

import { microcopy } from "../../constants/microcopy";

/**
 * Reusable unsaved-changes guard for modal/sheet close + cancel paths
 * (§2.A.1 of `docs/todo/ui-todo.md`).
 *
 * Given a way to read the surface's dirty state (typically an AntD
 * `form.isFieldsTouched()`) and the actual close handler, it returns a
 * `requestClose` callback the modal wires to its cancel / mask / Esc paths,
 * plus a `confirmNode` the modal renders once inside its tree. When the form
 * is clean `requestClose` runs `onConfirmDiscard` immediately with no prompt;
 * when it's dirty it opens a "Discard changes?" confirm and only runs
 * `onConfirmDiscard` if the user confirms. Cancelling the confirm ("Keep
 * editing") keeps the surface open and editable.
 *
 * The confirm surface is a CONTROLLED `<Dialog>` (not an imperative modal
 * API) so it:
 *   - mounts and unmounts with the host component (no cross-test leakage
 *     into `document.body`, which the imperative API caused), and
 *   - composes with the theme provider exactly like the other dialogs.
 * This mirrors the discard-confirm pattern already used by
 * `taskDetailPanel`.
 *
 * The guard owns ONLY the prompt + discard decision. Any side effects of
 * closing — `form.resetFields()`, clearing save errors, aborting in-flight
 * AI work via an AbortController, etc. — belong in the caller's
 * `onConfirmDiscard` so the existing abort-on-close behavior is preserved
 * untouched.
 */
export interface UnsavedChangesGuardOptions {
    /**
     * Reads the live dirty state. Called at close time (not bound at mount)
     * so it always reflects the latest touched state — pass e.g.
     * `() => form.isFieldsTouched()`.
     */
    isDirty: () => boolean;
    /**
     * Runs the real close + teardown. Invoked immediately on a clean close
     * and after the user confirms discarding a dirty surface.
     */
    onConfirmDiscard: () => void;
}

export interface UnsavedChangesGuard {
    /**
     * Wire to the modal's cancel / mask-click / Esc handler. Closes
     * immediately when clean; prompts to discard when dirty.
     */
    requestClose: () => void;
    /** Whether the discard-confirm dialog is currently shown. */
    isPrompting: boolean;
    /**
     * The confirm `<Dialog>`. Render it once inside the host modal's tree;
     * it is hidden chrome until `requestClose` is called on a dirty form.
     */
    confirmNode: React.ReactNode;
}

const useUnsavedChangesGuard = ({
    isDirty,
    onConfirmDiscard
}: UnsavedChangesGuardOptions): UnsavedChangesGuard => {
    const [isPrompting, setIsPrompting] = useState(false);

    const requestClose = useCallback(() => {
        if (!isDirty()) {
            onConfirmDiscard();
            return;
        }
        setIsPrompting(true);
    }, [isDirty, onConfirmDiscard]);

    const keepEditing = useCallback(() => {
        setIsPrompting(false);
    }, []);

    const confirmDiscard = useCallback(() => {
        setIsPrompting(false);
        onConfirmDiscard();
    }, [onConfirmDiscard]);

    const confirmNode = (
        <Dialog
            onOpenChange={(next) => {
                // Any dismissal (Esc, scrim, close button) is "Keep editing".
                if (!next) keepEditing();
            }}
            open={isPrompting}
        >
            <DialogContent className="max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>
                        {microcopy.confirm.discardChanges.title}
                    </DialogTitle>
                    <DialogDescription>
                        {microcopy.confirm.discardChanges.description}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button onClick={keepEditing}>
                        {microcopy.confirm.discardChanges.cancelLabel}
                    </Button>
                    <Button onClick={confirmDiscard} variant="destructive">
                        {microcopy.confirm.discardChanges.confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    return { requestClose, isPrompting, confirmNode };
};

export default useUnsavedChangesGuard;
