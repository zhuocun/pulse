import { useCallback, useEffect, useRef } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { UNDO_WINDOW_MS } from "../../theme/aiTokens";

import useAppMessage from "./useAppMessage";

/**
 * Toast Undo (PRD v3 §7.3, T-R1, T-R4, D-R5). Shows an AntD `message` with
 * a 10-second window to revert. The caller supplies:
 *
 *   - `apply`: the action that was just performed (used for analytics
 *     tagging, e.g. `"copilot.estimate.apply"`).
 *   - `undo`:  the inverse — restores the prior state. Called once if
 *     the user clicks Undo within the window.
 *
 * The hook returns a `show()` function the surface calls right after the
 * primary action lands. On unmount it tears down any in-flight toast so
 * a hidden component never resolves an undo.
 */
export interface UndoToastOptions {
    /** Sentence shown before the Undo link. */
    description: string;
    /**
     * Inverse operation. Returning a Promise lets the caller surface
     * loading state or report follow-up errors via `message.error`.
     */
    undo: () => void | Promise<void>;
    /** Analytics tag used by both the apply and undo events. */
    analyticsTag?: string;
    /** Override the 10-second window for tests. */
    durationMs?: number;
}

interface ShowResult {
    /** Programmatically dismisses the toast (e.g. on close of the parent). */
    dismiss: () => void;
}

const useUndoToast = (): {
    show: (options: UndoToastOptions) => ShowResult;
} => {
    // AntD v6: the static `message` import warns it can't read dynamic
    // theme. `useAppMessage()` returns a theme-aware instance (with a
    // static fallback for tests that render without `<App>`).
    const message = useAppMessage();
    const dismissRef = useRef<(() => void) | null>(null);

    useEffect(
        () => () => {
            dismissRef.current?.();
        },
        []
    );

    const show = useCallback(
        (options: UndoToastOptions): ShowResult => {
            const duration = (options.durationMs ?? UNDO_WINDOW_MS) / 1000;
            const key = `undo-${Date.now()}`;
            let undone = false;
            const handleUndo = async () => {
                if (undone) return;
                undone = true;
                try {
                    await options.undo();
                    track(ANALYTICS_EVENTS.UNDO_APPLIED, {
                        surface: options.analyticsTag ?? "unknown"
                    });
                    message.success(microcopy.mutation.undoApplied, 1.5);
                } catch {
                    message.error(microcopy.feedback.operationFailed, 2);
                } finally {
                    message.destroy(key);
                }
            };
            message.open({
                content: (
                    <span>
                        {options.description}{" "}
                        {/*
                         * Real <button> rather than an <a role="button"> so the
                         * native Enter / Space activation comes for free and so
                         * the control carries the AntD button focus ring on
                         * keyboard tab. The min-height lift keeps the tap target
                         * above the 44 px floor on coarse pointers — the toast
                         * appears center-screen on mobile and a thumb has to
                         * land it within the 10 s window.
                         */}
                        <button
                            onClick={handleUndo}
                            style={{
                                background: "transparent",
                                border: 0,
                                color: "var(--ant-color-primary, #EA580C)",
                                cursor: "pointer",
                                font: "inherit",
                                fontWeight: 500,
                                marginInlineStart: 8,
                                minHeight: 44,
                                padding: "4px 8px",
                                textDecoration: "underline"
                            }}
                            type="button"
                        >
                            {microcopy.ai.undoLabel}
                        </button>
                    </span>
                ),
                duration,
                key,
                type: "info"
            });
            const dismiss = () => message.destroy(key);
            dismissRef.current = dismiss;
            return { dismiss };
        },
        [message]
    );

    return { show };
};

export default useUndoToast;
