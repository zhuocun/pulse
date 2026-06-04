import { Modal } from "antd";
import {
    cloneElement,
    isValidElement,
    useCallback,
    useId,
    useState
} from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { breakpoints } from "../../theme/tokens";

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
 * The confirm surface is a CONTROLLED `<Modal>` (not the imperative
 * `Modal.confirm`) so it:
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
     * The confirm `<Modal>`. Render it once inside the host modal's tree;
     * it is hidden chrome until `requestClose` is called on a dirty form.
     */
    confirmNode: React.ReactNode;
}

const useUnsavedChangesGuard = ({
    isDirty,
    onConfirmDiscard
}: UnsavedChangesGuardOptions): UnsavedChangesGuard => {
    const [isPrompting, setIsPrompting] = useState(false);
    const bodyId = useId();

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
        <Modal
            cancelText={microcopyString(
                microcopy.confirm.discardChanges.cancelLabel
            )}
            centered
            okButtonProps={{ danger: true }}
            okText={microcopyString(
                microcopy.confirm.discardChanges.confirmLabel
            )}
            onCancel={keepEditing}
            onOk={confirmDiscard}
            open={isPrompting}
            title={microcopyString(microcopy.confirm.discardChanges.title)}
            width={Math.min(420, breakpoints.sm)}
            /*
             * Link the body to the dialog via aria-describedby so screen
             * reader users hear the description right after the title.
             * rc-dialog hardcodes only aria-labelledby; modalRender wraps
             * the inner container so we can inject the attribute there.
             */
            modalRender={(node) =>
                isValidElement(node)
                    ? cloneElement(
                          node as React.ReactElement<{
                              "aria-describedby"?: string;
                          }>,
                          { "aria-describedby": bodyId }
                      )
                    : node
            }
        >
            <div id={bodyId}>
                {microcopyString(microcopy.confirm.discardChanges.description)}
            </div>
        </Modal>
    );

    return { requestClose, isPrompting, confirmNode };
};

export default useUnsavedChangesGuard;
