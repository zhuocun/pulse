import { CloseOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Alert,
    Button,
    Input,
    Select,
    Skeleton,
    Space,
    Typography
} from "antd";
import React, { useCallback, useId, useMemo, useRef, useState } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { useLocale } from "../../i18n";
import {
    fontWeight,
    radius,
    semantic,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
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

const TouchButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

const TouchIconButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
    }
`;

const DiffRow = styled.div<{ $type: "context" | "added" | "removed" }>`
    background: ${({ $type }) =>
        $type === "added"
            ? semantic.successBg
            : $type === "removed"
              ? semantic.errorBg
              : "transparent"};
    color: ${({ $type }) => ($type === "removed" ? semantic.error : "inherit")};
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    padding-block: 1px;
    padding-inline: ${space.xs}px;
    text-decoration: ${({ $type }) =>
        $type === "removed" ? "line-through" : "none"};
    white-space: pre-wrap;
    word-break: break-word;
`;

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
                <Skeleton
                    active
                    aria-label={microcopyString(microcopy.aiRewrite.rewriting)}
                    paragraph={{ rows: 3 }}
                    title={false}
                />
            );
        }
        if (!result) return null;
        if (showDiff) {
            const lines = diffLines(note, result);
            return (
                <div
                    aria-label={microcopyString(microcopy.aiRewrite.diffLabel)}
                    role="group"
                    style={{
                        borderRadius: radius.sm,
                        overflow: "hidden"
                    }}
                >
                    {lines.map((line, index) => (
                        <DiffRow
                            $type={line.type}
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
                        </DiffRow>
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
            id={panelId}
            intensity="strong"
            onKeyDown={onKeyDown}
            tone="aurora"
            style={{
                borderRadius: radius.md,
                marginBlockStart: space.xs,
                padding: space.md
            }}
        >
            <SrOnlyLive>
                {isStreaming
                    ? microcopyString(microcopy.aiRewrite.streamingAnnouncement)
                    : ""}
            </SrOnlyLive>
            <div
                style={{
                    alignItems: "center",
                    display: "flex",
                    gap: space.xs,
                    justifyContent: "space-between",
                    marginBlockEnd: space.sm
                }}
            >
                <Space align="center" size={space.xs}>
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: fontWeight.semibold }}>
                        {microcopy.aiRewrite.panelTitle}
                    </span>
                </Space>
                <TouchIconButton
                    aria-label={microcopyString(microcopy.aiRewrite.closeAria)}
                    icon={<CloseOutlined aria-hidden />}
                    onClick={handleCancel}
                    size="small"
                    type="text"
                />
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
                aria-label={microcopyString(microcopy.aiRewrite.modeSelectAria)}
                autoFocus
                data-testid="ai-rewrite-mode"
                onChange={(value: RewriteMode) => setMode(value)}
                options={modeOptions}
                style={{ width: "100%" }}
                value={mode}
            />

            {mode === "free" ? (
                <div style={{ marginBlockStart: space.sm }}>
                    <Typography.Text
                        id={`${panelId}-free-label`}
                        style={{ display: "block", marginBlockEnd: space.xxs }}
                    >
                        {microcopy.aiRewrite.freePromptLabel}
                    </Typography.Text>
                    <Input.TextArea
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
                    data-testid="ai-rewrite-local-unsupported"
                    message={microcopy.aiRewrite.localUnsupported}
                    showIcon
                    style={{ marginBlock: space.sm }}
                    type="info"
                />
            ) : null}

            <div style={{ marginBlockStart: space.sm }}>
                <TouchButton
                    data-testid="ai-rewrite-run"
                    disabled={
                        noteEmpty ||
                        localUnsupportedMode ||
                        freePromptMissing ||
                        isStreaming
                    }
                    loading={isStreaming}
                    onClick={handleRewrite}
                    type="primary"
                >
                    {isStreaming
                        ? microcopy.aiRewrite.rewriting
                        : hasRun
                          ? microcopy.aiRewrite.regenerate
                          : microcopy.aiRewrite.rewriteButton}
                </TouchButton>
            </div>

            {error ? (
                <Alert
                    action={
                        <Button
                            onClick={handleRewrite}
                            size="small"
                            type="link"
                        >
                            {microcopy.aiRewrite.regenerate}
                        </Button>
                    }
                    data-testid="ai-rewrite-error"
                    message={microcopy.aiRewrite.errorTitle}
                    showIcon
                    style={{ marginBlockStart: space.sm }}
                    type="error"
                />
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
                        <Space style={{ marginBlockStart: space.sm }}>
                            <TouchButton
                                data-testid="ai-rewrite-accept"
                                onClick={handleAccept}
                                type="primary"
                            >
                                {microcopy.aiRewrite.accept}
                            </TouchButton>
                            <TouchButton
                                data-testid="ai-rewrite-cancel"
                                onClick={handleCancel}
                            >
                                {microcopy.aiRewrite.cancel}
                            </TouchButton>
                        </Space>
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
            <TouchButton
                aria-controls={open ? panelId : undefined}
                aria-expanded={open}
                aria-label={microcopyString(microcopy.aiRewrite.openButtonAria)}
                data-testid="ai-rewrite-open"
                icon={<AiSparkleIcon aria-hidden />}
                onClick={() => {
                    setAnnouncement("");
                    setOpen((prev) => !prev);
                }}
                ref={triggerRef}
                size="small"
            >
                {microcopy.aiRewrite.openButton}
            </TouchButton>
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
