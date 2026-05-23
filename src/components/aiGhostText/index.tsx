import { Input } from "antd";
import type { TextAreaRef } from "antd/lib/input/TextArea";
import type { TextAreaProps } from "antd/lib/input/TextArea";
import type { ChangeEvent, CompositionEvent, KeyboardEvent } from "react";
import React, {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { fontSize, space } from "../../theme/tokens";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import {
    noteCompletion,
    type NoteCompletionContext
} from "../../utils/ai/engine";

/**
 * Phase 4 W3 — Inline ghost-text suggestions in any task-note textarea
 * (docs/design/_review-2026-05/04-ai-copilot.md §Ambition 2).
 *
 *     <AiGhostText route="task-note" context={{ projectName, columnName, taskName, currentValue }}>
 *         <Input.TextArea ... />
 *     </AiGhostText>
 *
 * Behaviour:
 *  - Wraps any AntD `Input.TextArea`, preserving the child's props.
 *  - Debounces the user's input by 600 ms then asks the local engine
 *    (`utils/ai/engine#noteCompletion`) for a continuation.
 *  - Renders the completion as a faded overlay anchored to the textarea
 *    using a mirrored `div` that copies the textarea's text content so
 *    the suggestion always lines up after the caret.
 *  - Tab → accept (writes `value + suggestion` into the textarea, fires
 *    the child's `onChange`).
 *  - Esc → dismiss the *current* suggestion only; the next 600 ms debounce
 *    is still allowed to fire.
 *  - Typing / arrow keys → re-debounce.
 *  - IME composition (`event.nativeEvent.isComposing` or the React
 *    composition lifecycle) suspends the debounce until composition ends.
 *  - `prefers-reduced-motion: reduce` disables the fade-in transition on
 *    the suggestion text.
 *
 * Privacy: the wrapper only fires the completion request once the user
 * has acknowledged the route-scoped `CopilotPrivacyDisclosure` (the same
 * `boardCopilot:privacyShown:<route>` localStorage key the existing
 * popover writes). The flag default is OFF
 * (`REACT_APP_AI_GHOST_TEXT_ENABLED=false`); when either gate is closed
 * the component renders the wrapped textarea unchanged.
 *
 * Engine path: local-engine-only. The spec defers any remote round-trip
 * to a future iteration after privacy + perf prove out on the local
 * deterministic engine; calling out to the agent service from a 600 ms
 * debounce would torch both budgets simultaneously.
 */

export type AiGhostTextRoute = "task-note";

interface AiGhostTextProps {
    /** Logical surface name; drives the privacy-consent storage key. */
    route: AiGhostTextRoute;
    /** Engine-side grounding plus the live partial value from the textarea. */
    context: NoteCompletionContext;
    /**
     * The wrapped textarea. Must be an AntD `Input.TextArea`; props are
     * preserved and the wrapper hooks `onChange` / `onKeyDown` /
     * `onCompositionStart` / `onCompositionEnd` on top of the originals.
     */
    children: React.ReactElement;
    /** Debounce in ms. Defaults to 600 — see Ambition 2 spec. */
    debounceMs?: number;
}

const STORAGE_KEY_PREFIX = "boardCopilot:privacyShown:";

const readConsent = (route: AiGhostTextRoute): boolean => {
    if (typeof window === "undefined") return false;
    try {
        return (
            window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${route}`) === "1"
        );
    } catch {
        return false;
    }
};

const usePrivacyConsent = (route: AiGhostTextRoute): boolean => {
    const [consent, setConsent] = useState<boolean>(() => readConsent(route));
    useEffect(() => {
        // Re-read on mount in case the user acknowledged the disclosure on
        // another tab. We also subscribe to the cross-tab `storage` event
        // so revoking consent elsewhere downgrades this surface mid-session
        // without a reload.
        setConsent(readConsent(route));
        if (typeof window === "undefined") return;
        const key = `${STORAGE_KEY_PREFIX}${route}`;
        const handler = (event: StorageEvent) => {
            if (event.key && event.key !== key) return;
            setConsent(readConsent(route));
        };
        window.addEventListener("storage", handler);
        return () => window.removeEventListener("storage", handler);
    }, [route]);
    return consent;
};

const usePrefersReducedMotion = (): boolean => {
    const [reduced, setReduced] = useState<boolean>(() => {
        if (typeof window === "undefined" || !window.matchMedia) return false;
        try {
            return window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches;
        } catch {
            return false;
        }
    });
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        let media: MediaQueryList;
        try {
            media = window.matchMedia("(prefers-reduced-motion: reduce)");
        } catch {
            return;
        }
        const handler = (event: MediaQueryListEvent) =>
            setReduced(event.matches);
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
        }
        // Older Safari fallback
        media.addListener?.(handler);
        return () => media.removeListener?.(handler);
    }, []);
    return reduced;
};

/**
 * Mirror element that lines up exactly with the textarea so the
 * suggestion text appears immediately after the typed prefix. We render
 * the user's already-typed prefix in transparent text (so it consumes
 * the same horizontal/vertical run the real textarea uses) and append
 * the suggestion in a faded color.
 */
const renderMirrorContent = (
    prefix: string,
    suggestion: string
): React.ReactNode => {
    // The trailing newline trick: a textarea collapses a trailing
    // newline visually, so the mirror needs a sentinel character to
    // keep its dimensions in sync when the prefix ends in `\n`.
    const safePrefix = prefix.endsWith("\n") ? `${prefix} ` : prefix;
    return (
        <>
            <span style={{ color: "transparent" }}>{safePrefix}</span>
            <span
                style={{
                    color: "var(--color-copilot-fg-muted, rgba(124, 92, 255, 0.55))"
                }}
            >
                {suggestion}
            </span>
        </>
    );
};

const AiGhostText: React.FC<AiGhostTextProps> = ({
    route,
    context,
    children,
    debounceMs = 600
}) => {
    const flagOn = environment.aiGhostTextEnabled;
    const consent = usePrivacyConsent(route);
    const reducedMotion = usePrefersReducedMotion();
    const textAreaRef = useRef<TextAreaRef | null>(null);
    const mirrorRef = useRef<HTMLDivElement | null>(null);
    const composingRef = useRef<boolean>(false);
    const [suggestion, setSuggestion] = useState<string>("");
    const [debouncedValue, setDebouncedValue] = useState<string>(
        context.currentValue
    );
    const [srMessage, setSrMessage] = useState<string>("");

    const enabled = flagOn && consent;

    if (!isValidElement(children)) {
        // Caller passed an invalid child — fall back to rendering null
        // rather than crashing the modal. This branch is unreachable in
        // type-checked callsites.
        return null;
    }

    const childProps = (children as React.ReactElement<TextAreaProps>).props;

    // ---- Debounce ---------------------------------------------------
    useEffect(() => {
        if (!enabled) return;
        if (composingRef.current) return;
        const handle = window.setTimeout(() => {
            setDebouncedValue(context.currentValue);
        }, debounceMs);
        return () => window.clearTimeout(handle);
    }, [context.currentValue, debounceMs, enabled]);

    // ---- Engine call (synchronous, deterministic) ------------------
    useEffect(() => {
        if (!enabled) {
            if (suggestion !== "") setSuggestion("");
            return;
        }
        const result = noteCompletion({
            projectName: context.projectName,
            columnName: context.columnName,
            taskName: context.taskName,
            type: context.type,
            currentValue: debouncedValue
        });
        // Defensive guard: never let the engine "complete" something that
        // would shrink or duplicate what the user already typed.
        if (!result || result.length === 0) {
            setSuggestion("");
            return;
        }
        setSuggestion(result);
    }, [
        debouncedValue,
        enabled,
        context.projectName,
        context.columnName,
        context.taskName,
        context.type
    ]);

    // ---- Announce suggestion to screen readers ---------------------
    useEffect(() => {
        if (!enabled) return;
        if (suggestion.length === 0) return;
        const prefix = microcopy.ai.ghostText.srOnlySuggestionPrefix;
        setSrMessage(`${prefix} ${suggestion}`);
    }, [enabled, suggestion]);

    // ---- Mirror scroll sync ----------------------------------------
    useLayoutEffect(() => {
        const ta = textAreaRef.current?.resizableTextArea?.textArea;
        const mirror = mirrorRef.current;
        if (!ta || !mirror) return;
        mirror.scrollTop = ta.scrollTop;
        mirror.scrollLeft = ta.scrollLeft;
    });

    const dismiss = useCallback(() => {
        if (suggestion.length === 0) return;
        setSuggestion("");
        setSrMessage(microcopy.ai.ghostText.srOnlySuggestionDismissed);
    }, [suggestion.length]);

    const accept = useCallback(() => {
        if (suggestion.length === 0) return;
        const next = context.currentValue + suggestion;
        // Fire the child's onChange exactly as a synthetic input event
        // would so AntD Form bindings update. The textarea exposes a
        // mutable `value`; setting it then dispatching a native `input`
        // event is the canonical "react-controlled" handoff used across
        // the codebase (see useChatComposerHistoryRecall).
        const ta = textAreaRef.current?.resizableTextArea?.textArea;
        if (ta) {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            )?.set;
            setter?.call(ta, next);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (typeof childProps.onChange === "function") {
            const synthetic = {
                target: { value: next }
            } as unknown as ChangeEvent<HTMLTextAreaElement>;
            childProps.onChange(synthetic);
        }
        setSuggestion("");
        setDebouncedValue(next);
        setSrMessage(microcopy.ai.ghostText.srOnlySuggestionAccepted);
    }, [childProps, context.currentValue, suggestion]);

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLTextAreaElement>) => {
            // IME-active composition keys never trigger accept/dismiss
            // — Enter inside CJK candidate selection is a "confirm
            // composition", not "accept ghost text". This is the same
            // gate the chat composer's Wave 1 fix added.
            const isComposing = event.nativeEvent.isComposing === true;
            if (!isComposing && suggestion.length > 0) {
                if (event.key === "Tab") {
                    event.preventDefault();
                    accept();
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    dismiss();
                    return;
                }
            }
            if (typeof childProps.onKeyDown === "function") {
                childProps.onKeyDown(event);
            }
        },
        [accept, childProps, dismiss, suggestion.length]
    );

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLTextAreaElement>) => {
            // Typing always invalidates the current suggestion; the
            // next debounce tick will rehydrate it if still relevant.
            if (suggestion.length > 0) {
                setSuggestion("");
            }
            if (typeof childProps.onChange === "function") {
                childProps.onChange(event);
            }
        },
        [childProps, suggestion.length]
    );

    const handleCompositionStart = useCallback(
        (event: CompositionEvent<HTMLTextAreaElement>) => {
            composingRef.current = true;
            if (typeof childProps.onCompositionStart === "function") {
                childProps.onCompositionStart(event);
            }
        },
        [childProps]
    );

    const handleCompositionEnd = useCallback(
        (event: CompositionEvent<HTMLTextAreaElement>) => {
            composingRef.current = false;
            if (typeof childProps.onCompositionEnd === "function") {
                childProps.onCompositionEnd(event);
            }
        },
        [childProps]
    );

    // If the surface is not enabled (flag off OR consent not given), or
    // the wrapped element is not actually a textarea, render the child
    // untouched. This is the privacy gate the Ambition 2 spec calls
    // out: no overlay, no engine call, no debounce, no listeners.
    const fallthroughChild = useMemo(() => {
        if (children.type === Input.TextArea) {
            // ``ref`` is not declared on ``TextAreaProps`` — AntD wires it
            // via ``React.forwardRef``, so cast the override to ``unknown``
            // first to bypass the strict TextArea prop type.
            return cloneElement(children, {
                ref: textAreaRef
            } as unknown as Record<string, unknown>);
        }
        return children;
    }, [children]);

    if (!enabled) {
        // Still expose the ref so the host modal can focus the textarea.
        return fallthroughChild;
    }

    // ---- Active rendering path -------------------------------------
    // Wrap the textarea in a relatively-positioned shell so the absolute
    // mirror overlay can stretch over the textarea's visible bounds.
    const wrappedChild = cloneElement(children, {
        ref: textAreaRef,
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        onCompositionStart: handleCompositionStart,
        onCompositionEnd: handleCompositionEnd
    } as unknown as Record<string, unknown>);

    return (
        <div
            data-testid="ai-ghost-text"
            style={{
                position: "relative",
                width: "100%"
            }}
        >
            {wrappedChild}
            {suggestion.length > 0 ? (
                <>
                    <div
                        aria-hidden
                        data-testid="ai-ghost-text-overlay"
                        data-reduced-motion={reducedMotion ? "true" : "false"}
                        ref={mirrorRef}
                        style={{
                            // Keep the mirror perfectly aligned with the
                            // actual textarea by inheriting every layout
                            // property from `font` / padding / border so
                            // the runs wrap identically.
                            boxSizing: "border-box",
                            font: "inherit",
                            inset: 0,
                            // 1.5715 matches AntD's default line-height for
                            // Input.TextArea (computed value when the host
                            // does not override it).
                            lineHeight: 1.5715,
                            overflow: "hidden",
                            padding: `${space.xs}px ${space.sm}px`,
                            pointerEvents: "none",
                            position: "absolute",
                            transition: reducedMotion
                                ? "none"
                                : "opacity 120ms ease-in",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            zIndex: 1
                        }}
                    >
                        {renderMirrorContent(context.currentValue, suggestion)}
                    </div>
                    <div
                        aria-hidden
                        data-testid="ai-ghost-text-hint"
                        style={{
                            color: "var(--color-text-tertiary, rgba(15, 23, 42, 0.55))",
                            fontSize: fontSize.xs,
                            marginTop: 4,
                            pointerEvents: "none"
                        }}
                    >
                        {microcopy.ai.ghostText.acceptHint}
                    </div>
                </>
            ) : null}
            <SrOnlyLive aria-live="polite">{srMessage}</SrOnlyLive>
        </div>
    );
};

export default AiGhostText;
