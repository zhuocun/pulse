import { AlertCircle, Info, X } from "lucide-react";
import React, { useCallback, useId, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { useLocale } from "../../i18n";
import { fontWeight, space } from "../../theme/tokens";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import {
    diffLines,
    REWRITE_MODES,
    shouldShowDiff,
    type RewriteMode,
    type RewriteRequest
} from "../../utils/ai/rewrite";
import useRewrite from "../../utils/hooks/useRewrite";
import AiSparkleIcon from "../aiSparkleIcon";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import GlassPanel from "../glassPanel";

const srOnly: React.CSSProperties = {
    border: 0,
    clip: "rect(0 0 0 0)",
    height: 1,
    margin: -1,
    overflow: "hidden",
    padding: 0,
    position: "absolute",
    whiteSpace: "nowrap",
    width: 1
};

const DIFF_ROW_BASE =
    "px-xs py-[1px] font-mono text-[0.85em] whitespace-pre-wrap break-words";

const DIFF_ROW_TONE: Record<"context" | "added" | "removed", string> = {
    context: "",
    added: "bg-successBg",
    removed: "bg-errorBg text-error line-through"
};

interface RewritePanelBodyProps {
    note: string;
    projectId?: string;
    panelId: string;
    onAccept: (rewritten: string, mode: RewriteMode) => void;
    onClose: () => void;
}

/**
 * The interactive body of the rewrite side panel. Mounted only while the
 * panel is open so that closing it unmounts `useRewrite` — which aborts any
 * in-flight stream via `useAgent`'s unmount cleanup (AC-V12 "aborts on
 * close").
 */
const RewritePanelBody: React.FC<RewritePanelBodyProps> = ({
    note,
    projectId,
    panelId,
    onAccept,
    onClose
}) => {
    const { locale, entry, availableLocales } = useLocale();
    const isRemote = !environment.aiUseLocalEngine;
    const { result, isStreaming, error, run, abort } = useRewrite(projectId);

    const [mode, setMode] = useState<RewriteMode>("polish");
    const [freePrompt, setFreePrompt] = useState("");
    const [hasRun, setHasRun] = useState(false);

    // Translate targets the OTHER configured locale (en ⇄ zh-CN) so the
    // option is meaningful regardless of which language the UI is in.
    const targetLocale = useMemo(
        () => availableLocales.find((l) => l.code !== locale) ?? entry,
        [availableLocales, locale, entry]
    );

    const trimmedNote = note.trim();
    const noteEmpty = trimmedNote.length === 0;
    const localUnsupportedMode =
        !isRemote && (mode === "translate" || mode === "free");
    const freePromptMissing = mode === "free" && freePrompt.trim().length === 0;

    const modeOptions = useMemo(
        () =>
            REWRITE_MODES.map((m) => ({
                value: m,
                label:
                    m === "translate"
                        ? microcopyString(
                              microcopy.aiRewrite.modes.translate
                          ).replace("{language}", targetLocale.nativeName)
                        : microcopy.aiRewrite.modes[m]
            })),
        [targetLocale.nativeName]
    );

    const handleRewrite = useCallback(() => {
        if (noteEmpty || localUnsupportedMode || freePromptMissing) return;
        const request: RewriteRequest = {
            mode,
            note,
            localeName: targetLocale.englishName,
            freePrompt
        };
        setHasRun(true);
        run(request);
    }, [
        noteEmpty,
        localUnsupportedMode,
        freePromptMissing,
        mode,
        note,
        targetLocale.englishName,
        freePrompt,
        run
    ]);

    const handleAccept = useCallback(() => {
        if (!result) return;
        onAccept(result, mode);
        track(ANALYTICS_EVENTS.COPILOT_REWRITE_ACCEPT, {
            field: "note",
            mode,
            ...(projectId ? { projectId } : {})
        });
        onClose();
    }, [result, onAccept, mode, projectId, onClose]);

    const handleCancel = useCallback(() => {
        abort();
        onClose();
    }, [abort, onClose]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            handleCancel();
        }
    };

    const showDiff = !isStreaming && Boolean(result) && shouldShowDiff(note);
    const resultView = (() => {
        if (isStreaming && !result) {
            return (
                <div
                    aria-label={microcopyString(microcopy.aiRewrite.rewriting)}
                    role="status"
                >
                    <Skeleton className="mb-xs h-4 w-full" />
                    <Skeleton className="mb-xs h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                </div>
            );
        }
        if (!result) return null;
        if (showDiff) {
            const lines = diffLines(note, result);
            return (
                <div
                    aria-label={microcopyString(microcopy.aiRewrite.diffLabel)}
                    className="overflow-hidden rounded-sm"
                    role="group"
                >
                    {lines.map((line, index) => (
                        <div
                            className={cn(
                                DIFF_ROW_BASE,
                                DIFF_ROW_TONE[line.type]
                            )}
                            key={`${line.type}-${index}-${line.text}`}
                        >
                            {line.type !== "context" ? (
                                <span style={srOnly}>
                                    {line.type === "added"
                                        ? microcopyString(
                                              microcopy.aiRewrite.diffAddedAria
                                          )
                                        : microcopyString(
                                              microcopy.aiRewrite
                                                  .diffRemovedAria
                                          )}
                                    {": "}
                                </span>
                            ) : null}
                            {line.text.length > 0 ? line.text : "\u00A0"}
                        </div>
                    ))}
                </div>
            );
        }
        return (
            <Typography.Paragraph
                style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word"
                }}
            >
                {result}
            </Typography.Paragraph>
        );
    })();

    return (
        <GlassPanel
            as="section"
            aria-label={microcopyString(microcopy.aiRewrite.panelAriaLabel)}
            className="mt-xs rounded-md p-md"
            id={panelId}
            intensity="strong"
            onKeyDown={onKeyDown}
            tone="aurora"
        >
            <SrOnlyLive>
                {isStreaming
                    ? microcopyString(microcopy.aiRewrite.streamingAnnouncement)
                    : ""}
            </SrOnlyLive>
            <div className="mb-sm flex items-center justify-between gap-xs">
                <span className="inline-flex items-center gap-xs">
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: fontWeight.semibold }}>
                        {microcopy.aiRewrite.panelTitle}
                    </span>
                </span>
                <Button
                    aria-label={microcopyString(microcopy.aiRewrite.closeAria)}
                    className="coarse:min-w-[44px]"
                    onClick={handleCancel}
                    size="icon"
                    variant="ghost"
                >
                    <X aria-hidden />
                </Button>
            </div>

            <CopilotRemoteConsentNotice route="task-note" />

            <Typography.Text
                id={`${panelId}-mode-label`}
                strong
                style={{ display: "block", marginBlockEnd: space.xxs }}
            >
                {microcopy.aiRewrite.modeLabel}
            </Typography.Text>
            <Select
                onValueChange={(value) => setMode(value as RewriteMode)}
                value={mode}
            >
                <SelectTrigger
                    aria-label={microcopyString(
                        microcopy.aiRewrite.modeSelectAria
                    )}
                    autoFocus
                    data-testid="ai-rewrite-mode"
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {modeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {mode === "free" ? (
                <div style={{ marginBlockStart: space.sm }}>
                    <Typography.Text
                        id={`${panelId}-free-label`}
                        style={{ display: "block", marginBlockEnd: space.xxs }}
                    >
                        {microcopy.aiRewrite.freePromptLabel}
                    </Typography.Text>
                    <Textarea
                        aria-labelledby={`${panelId}-free-label`}
                        autoComplete="off"
                        data-testid="ai-rewrite-free-prompt"
                        enterKeyHint="enter"
                        inputMode="text"
                        onChange={(event) => setFreePrompt(event.target.value)}
                        placeholder={microcopy.aiRewrite.freePromptPlaceholder}
                        rows={2}
                        value={freePrompt}
                    />
                </div>
            ) : null}

            {noteEmpty ? (
                <Typography.Paragraph
                    style={{ marginBlock: space.sm }}
                    type="secondary"
                >
                    {microcopy.aiRewrite.emptyNoteHint}
                </Typography.Paragraph>
            ) : null}

            {localUnsupportedMode ? (
                <Alert
                    className="my-sm"
                    data-testid="ai-rewrite-local-unsupported"
                    variant="info"
                >
                    <Info aria-hidden />
                    <AlertTitle>
                        {microcopy.aiRewrite.localUnsupported}
                    </AlertTitle>
                </Alert>
            ) : null}

            <div style={{ marginBlockStart: space.sm }}>
                <Button
                    data-testid="ai-rewrite-run"
                    disabled={
                        noteEmpty ||
                        localUnsupportedMode ||
                        freePromptMissing ||
                        isStreaming
                    }
                    loading={isStreaming}
                    onClick={handleRewrite}
                    variant="primary"
                >
                    {isStreaming
                        ? microcopy.aiRewrite.rewriting
                        : hasRun
                          ? microcopy.aiRewrite.regenerate
                          : microcopy.aiRewrite.rewriteButton}
                </Button>
            </div>

            {error ? (
                <Alert
                    className="mt-sm"
                    data-testid="ai-rewrite-error"
                    variant="destructive"
                >
                    <AlertCircle aria-hidden />
                    <AlertTitle>{microcopy.aiRewrite.errorTitle}</AlertTitle>
                    <AlertDescription>
                        <Button
                            className="h-auto p-0"
                            onClick={handleRewrite}
                            size="sm"
                            variant="link"
                        >
                            {microcopy.aiRewrite.regenerate}
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : null}

            {resultView ? (
                <div style={{ marginBlockStart: space.sm }}>
                    <Typography.Text
                        strong
                        style={{
                            display: "block",
                            marginBlockEnd: space.xxs
                        }}
                    >
                        {microcopy.aiRewrite.resultLabel}
                    </Typography.Text>
                    <div data-testid="ai-rewrite-result">{resultView}</div>
                    {!isStreaming && result ? (
                        <div className="mt-sm flex flex-wrap gap-xs">
                            <Button
                                data-testid="ai-rewrite-accept"
                                onClick={handleAccept}
                                variant="primary"
                            >
                                {microcopy.aiRewrite.accept}
                            </Button>
                            <Button
                                data-testid="ai-rewrite-cancel"
                                onClick={handleCancel}
                            >
                                {microcopy.aiRewrite.cancel}
                            </Button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </GlassPanel>
    );
};

export interface AiRewritePanelProps {
    /** Current note text — the rewrite source and the diff baseline. */
    note: string;
    projectId?: string;
    /** Apply the accepted rewrite to the note field (caller stamps the badge). */
    onAccept: (rewritten: string) => void;
}

/**
 * "Rewrite with AI" trigger + side panel for the task note editor
 * (PRD-GAP-012, v3 §7.5, v2.1 AC-V12).
 *
 * Renders a button above the note textarea; clicking it expands an inline
 * panel (the textarea stays visible) where the user picks a rewrite style,
 * previews the streamed result — a line diff for notes longer than three
 * lines — then Accepts (which replaces the note and lets the caller stamp
 * the "Suggested by Copilot" badge) or Cancels (which leaves the note
 * untouched). Closing the panel aborts any in-flight stream.
 */
const AiRewritePanel: React.FC<AiRewritePanelProps> = ({
    note,
    projectId,
    onAccept
}) => {
    const [open, setOpen] = useState(false);
    const [announcement, setAnnouncement] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    const close = useCallback(() => {
        setOpen(false);
        // Return focus to the trigger so keyboard users are not stranded.
        triggerRef.current?.focus();
    }, []);

    const handleAccept = useCallback(
        (rewritten: string) => {
            onAccept(rewritten);
            setAnnouncement(
                microcopyString(microcopy.aiRewrite.acceptedAnnouncement)
            );
        },
        [onAccept]
    );

    return (
        <div>
            <SrOnlyLive>{announcement}</SrOnlyLive>
            <Button
                aria-controls={open ? panelId : undefined}
                aria-expanded={open}
                aria-label={microcopyString(microcopy.aiRewrite.openButtonAria)}
                data-testid="ai-rewrite-open"
                onClick={() => {
                    setAnnouncement("");
                    setOpen((prev) => !prev);
                }}
                ref={triggerRef}
                size="sm"
            >
                <AiSparkleIcon aria-hidden />
                {microcopy.aiRewrite.openButton}
            </Button>
            {open ? (
                <RewritePanelBody
                    note={note}
                    onAccept={handleAccept}
                    onClose={close}
                    panelId={panelId}
                    projectId={projectId}
                />
            ) : null}
        </div>
    );
};

export default AiRewritePanel;
