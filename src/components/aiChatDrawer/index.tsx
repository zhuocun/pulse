import { ReloadOutlined, StopOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Alert,
    App,
    Button,
    Drawer,
    Grid,
    Input,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import useAiChat from "../../utils/hooks/useAiChat";
import AiFeedbackPopover, {
    type AiFeedbackSubmission
} from "../aiFeedbackPopover";
import AiSparkleIcon from "../aiSparkleIcon";
import CitationChip from "../citationChip";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import EngineModeTag from "../engineModeTag";

const MessageRow = styled.div<{ $isUser: boolean }>`
    margin-bottom: ${space.sm}px;
    text-align: ${(props) => (props.$isUser ? "right" : "left")};
`;

/**
 * Chat bubble. Centralizing the bubble's background, padding, and width
 * cap here means a tweak to the chat visual language is one edit instead
 * of three duplicated inline-style objects.
 */
const MessageBubble = styled(Typography.Paragraph)<{ $isUser: boolean }>`
    && {
        background: ${(props) =>
            props.$isUser
                ? "var(--ant-color-primary-bg, rgba(234, 88, 12, 0.10))"
                : "var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04))"};
        border-radius: ${radius.md}px;
        color: var(--ant-color-text, inherit);
        display: inline-block;
        margin-bottom: 0;
        max-width: min(100%, 36rem);
        padding: ${space.xs}px ${space.sm}px;
        text-align: left;
        white-space: pre-wrap;
        word-break: break-word;
    }

    && pre,
    && code {
        max-width: 100%;
        overflow-x: auto;
    }
`;

/**
 * AntD's `Typography.Text` with `code` looks heavy here; this is a
 * lightweight pseudo-cursor that pulses while tokens stream in. The
 * bare span avoids a re-render storm from CSS animations on every chunk.
 */
const StreamingCursor = styled.span`
    display: inline-block;
    margin-inline-start: 2px;
    animation: aiCursorBlink 1s steps(1) infinite;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));

    @keyframes aiCursorBlink {
        50% {
            opacity: 0;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

/**
 * Attribution row above each assistant bubble (P2-5). The sparkle is
 * decorative — the visible "Board Copilot" label is what screen readers
 * announce. Pairing the model name with the bubble matches the
 * ChatGPT/Claude convention so users always know the source of the text.
 */
const AssistantAttribution = styled.div`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: 4px;
    margin-bottom: ${space.xxs}px;
`;

/**
 * "AI · review before using" footnote below each assistant bubble (P2-2).
 * Kept intentionally low-contrast so it sits out of the reading flow but
 * remains discoverable when users are calibrating trust on a response.
 */
const AssistantDisclaimer = styled.div`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
    font-size: ${fontSize.xs}px;
    margin-top: 2px;
`;

const SamplePrompt = styled(Tag.CheckableTag)`
    && {
        border-radius: ${radius.pill}px;
        font-weight: ${fontWeight.medium};
        padding: ${space.xxs}px ${space.sm}px;
    }
`;

const ToolDetails = styled.details`
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.02));
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.xs}px;
    margin: ${space.xxs}px 0;
    padding: ${space.xxs}px ${space.xs}px;

    summary {
        cursor: pointer;
        outline: none;
    }

    summary:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 2px;
    }
`;

const { Text } = Typography;

interface ChatTurnFeedback {
    /** Index of the assistant message in the visible transcript. */
    index: number;
    value: "up" | "down";
}

export interface AiChatDrawerProps {
    open: boolean;
    onClose: () => void;
    /** Current project when on a board; omit or null on the project list */
    project: IProject | null;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
    /** Every project id the user may reference (e.g. list query + current) */
    knownProjectIds: string[];
    /**
     * Optional pre-populated prompt (e.g. dispatched from the command
     * palette in AI mode). The drawer auto-sends this when it opens with
     * a non-empty value.
     */
    initialPrompt?: string;
}

/**
 * Plain-language verb for each known tool (Optimization Plan §3 P2-2).
 *
 * Tool messages in the chat transcript should read like evidence the
 * assistant gathered ("Checked 12 tasks"), not like a function call
 * ("listTasks · 12 items"). Unmapped tools fall back to a sentence-cased
 * version of the raw name so a future tool that hasn't been wired here
 * still produces sensible UI.
 */
const TOOL_VERB: Record<string, string> = {
    listProjects: "Checked projects",
    listMembers: "Checked team members",
    listBoard: "Checked board columns",
    listTasks: "Checked tasks",
    getProject: "Opened project",
    getTask: "Opened task"
};

const humanizeTool = (name?: string) => {
    if (!name) return "Looked up evidence";
    if (TOOL_VERB[name]) return TOOL_VERB[name];
    return name
        .replace(/^.*:/, "")
        .replace(/[._]/g, " ")
        .replace(/^./, (s) => s.toUpperCase());
};

/**
 * Tool message bodies are now plain-language evidence summaries (see
 * `summarizeToolResultForUser`) instead of raw JSON. The collapsed
 * `<details>` summary line just shows the first sentence so users can
 * scan the evidence chain without expanding every row.
 */
const summarizeToolBody = (body: string): string => {
    const trimmed = body.trim();
    if (!trimmed) return "empty result";
    const firstLine = trimmed.split("\n", 1)[0];
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
};

/**
 * Citations are inline superscript chips after the assistant bubble. When
 * an answer leans on a lot of records (e.g. a workload summary that cites
 * every member) rendering all of them inline produces a sprawling chip
 * tail that crowds the message. We collapse anything over this threshold
 * behind a "+N more" affordance — clicking it expands the list inline
 * (no second click required) so verifying every claim is still possible.
 */
const CITATION_INLINE_LIMIT = 6;

const AiChatDrawer: React.FC<AiChatDrawerProps> = ({
    open,
    onClose,
    project,
    columns,
    tasks,
    members,
    knownProjectIds,
    initialPrompt
}) => {
    const [input, setInput] = useState("");
    const [feedback, setFeedback] = useState<ChatTurnFeedback[]>([]);
    /**
     * Set of message indices that arrived as the result of a Regenerate
     * click (P1-2). Tracked instead of derived so an out-of-band reset or
     * a stream interruption can't desync the badge from the bubble it
     * decorates. The set is wiped on `resetAll`.
     */
    const [regeneratedIndices, setRegeneratedIndices] = useState<Set<number>>(
        () => new Set()
    );
    /**
     * Per-message override that opts the user in to the full citation
     * list once they've clicked "+N more". Indexed by message index so a
     * regenerate or new conversation naturally drops the override.
     * Hoisted above `resetAll` so the callback can reset it without a
     * forward-reference cycle.
     */
    const [expandedCitations, setExpandedCitations] = useState<Set<number>>(
        () => new Set()
    );

    const expandCitations = useCallback((turnIndex: number) => {
        setExpandedCitations((prev) => {
            if (prev.has(turnIndex)) return prev;
            const next = new Set(prev);
            next.add(turnIndex);
            return next;
        });
    }, []);
    /**
     * Length of `messages` at the moment Regenerate was clicked. The
     * `useEffect` watching `messages.length` uses this to identify the
     * freshly-arrived assistant turn (the next assistant role beyond this
     * length) and tag it.
     */
    const pendingRegenAfter = useRef<number | null>(null);
    /**
     * Citations indexed by assistant turn (C-R7). The drawer renders a
     * `CitationChip` superscript for each item right after the bubble.
     * Until the agent emits real citations on the chat route, we extract
     * citations from inline `[cite:taskId]` markers in the assistant
     * text — falls back gracefully when the model produces none.
     */
    const inputRef = useRef<TextAreaRef | null>(null);
    const screens = Grid.useBreakpoint();
    const drawerWidth = screens.md ? 420 : "100%";
    const initialPromptHandled = useRef<string | null>(null);
    const { message } = App.useApp();

    useEffect(() => {
        if (!open) {
            return;
        }
        const handle = window.setTimeout(() => {
            inputRef.current?.focus({ cursor: "end" });
        }, 0);
        return () => window.clearTimeout(handle);
    }, [open]);

    const chatCtx = useMemo(() => {
        const knownProjectSet = new Set(knownProjectIds);
        const pid = project?._id ?? "";
        if (pid) knownProjectSet.add(pid);

        return {
            engine: {
                columns,
                members,
                project: project ?? {
                    _id: "",
                    projectName: "Projects"
                },
                tasks
            },
            execution: {
                knownColumnIds: new Set(columns.map((c) => c._id)),
                knownMemberIds: new Set(members.map((m) => m._id)),
                knownProjectIds: knownProjectSet,
                knownTaskIds: new Set(tasks.map((t) => t._id)),
                projectId: pid
            }
        };
    }, [columns, knownProjectIds, members, project, tasks]);

    const {
        abort,
        dismissError,
        error,
        isLoading,
        messages,
        reset,
        send,
        streamingText
    } = useAiChat(open ? chatCtx : null);

    /** Reset the local UI state too (feedback, citations) on hard reset. */
    const resetAll = useCallback(() => {
        reset();
        setFeedback([]);
        setRegeneratedIndices(new Set());
        setExpandedCitations(new Set());
        pendingRegenAfter.current = null;
    }, [reset]);

    /**
     * "New conversation" voluntary reset (C-R1). The drawer no longer
     * destroys the transcript on close — the previous `destroyOnHidden`
     * flag wiped the panel even on accidental clicks.
     */
    const handleClose = () => {
        abort();
        setInput("");
        onClose();
    };

    const dispatch = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return;
            track(ANALYTICS_EVENTS.COPILOT_CHAT_SEND, {
                length: trimmed.length
            });
            setInput("");
            startTransition(() => {
                void send(trimmed);
            });
        },
        [send]
    );

    /**
     * Auto-fire the initial prompt dispatched from the command palette
     * (CP-R6). Keep a ref of the last prompt we handled so a re-render
     * doesn't re-send it.
     */
    useEffect(() => {
        if (!open || !initialPrompt) return;
        if (initialPromptHandled.current === initialPrompt) return;
        initialPromptHandled.current = initialPrompt;
        dispatch(initialPrompt);
    }, [dispatch, initialPrompt, open]);

    useEffect(() => {
        if (!open) initialPromptHandled.current = null;
    }, [open]);

    const handleSend = () => {
        dispatch(input);
    };

    const handleRegenerate = (turnIndex: number) => {
        // Find the user message that produced this assistant turn, then
        // re-send it. The chat engine appends to the transcript, so the
        // new turn lands as a fresh assistant bubble below the original.
        const msg = messages[turnIndex];
        if (!msg) return;
        const previous = messages
            .slice(0, turnIndex)
            .reverse()
            .find((m) => m.role === "user");
        if (!previous) return;
        track(ANALYTICS_EVENTS.COPILOT_CHAT_REGENERATE, {
            surface: "chat-drawer"
        });
        // Mark the next assistant message as regenerated so the user can
        // tell which bubble is the fresh answer (P1-2).
        pendingRegenAfter.current = messages.length;
        dispatch(previous.content);
    };

    /**
     * After a Regenerate, watch for the first assistant message that
     * lands beyond the recorded length and tag it. We compare lengths
     * (not roles) so an interleaving tool message can't trip the marker.
     */
    useEffect(() => {
        if (pendingRegenAfter.current === null) return;
        if (isLoading) return;
        if (messages.length <= pendingRegenAfter.current) return;
        const next = messages
            .slice(pendingRegenAfter.current)
            .findIndex((m) => m.role === "assistant");
        if (next < 0) return;
        const absoluteIndex = pendingRegenAfter.current + next;
        setRegeneratedIndices((prev) => {
            if (prev.has(absoluteIndex)) return prev;
            const updated = new Set(prev);
            updated.add(absoluteIndex);
            return updated;
        });
        pendingRegenAfter.current = null;
    }, [isLoading, messages]);

    /**
     * Index of the assistant message whose thumbs-down popover is open
     * (Optimization Plan §3 P1-3). `null` keeps every popover closed; this
     * lets a click on one bubble's button close another bubble's panel
     * cleanly without managing a per-row open state.
     */
    const [feedbackOpenFor, setFeedbackOpenFor] = useState<number | null>(null);

    const recordFeedback = (
        turnIndex: number,
        value: "up" | "down",
        extras?: { categories?: string[]; hasNote?: boolean }
    ) => {
        const turn = messages[turnIndex];
        track(ANALYTICS_EVENTS.THUMBS_FEEDBACK, {
            value,
            index: turnIndex,
            citationCount: turn?.citations?.length ?? 0,
            ...extras
        });
        setFeedback((prev) => {
            const next = prev.filter((entry) => entry.index !== turnIndex);
            next.push({ index: turnIndex, value });
            return next;
        });
    };

    const handleThumbsUp = (turnIndex: number) => {
        const existing = feedback.find((entry) => entry.index === turnIndex);
        // De-dupe repeat clicks on the same value so we don't fire the
        // toast or analytics for an effectively no-op interaction.
        if (existing?.value === "up") return;
        recordFeedback(turnIndex, "up");
        message.success(microcopy.ai.feedbackThanks);
    };

    const handleThumbsDownClick = (turnIndex: number) => {
        // Toggle the popover for this row. If the user clicks 👎 again we
        // close the panel rather than re-record a vote, giving them an
        // escape hatch from the form without needing the Skip button.
        setFeedbackOpenFor((current) =>
            current === turnIndex ? null : turnIndex
        );
    };

    const handleFeedbackPopoverChange = (
        turnIndex: number,
        isOpen: boolean
    ) => {
        setFeedbackOpenFor(isOpen ? turnIndex : null);
    };

    const handleSubmitFeedbackDown = (
        turnIndex: number,
        submission: AiFeedbackSubmission
    ) => {
        recordFeedback(turnIndex, "down", {
            categories: submission.categories,
            hasNote: submission.note.length > 0
        });
        setFeedbackOpenFor(null);
        message.success(microcopy.ai.feedbackThanks);
    };

    const handleSkipFeedbackDown = (turnIndex: number) => {
        // Skip records the down vote without categories so we still know
        // the user was unhappy, just not why.
        recordFeedback(turnIndex, "down");
        setFeedbackOpenFor(null);
    };

    const errorView = error ? aiErrorView(error) : null;

    /**
     * Fix 9 — Rate-limit countdown. When the error template exposes a
     * `disabledForSeconds` hint, count down to zero so the retry button
     * re-enables itself automatically without a reload.
     */
    const [retryCountdown, setRetryCountdown] = useState(0);
    useEffect(() => {
        const secs = errorView?.disabledForSeconds ?? 0;
        if (secs <= 0) {
            setRetryCountdown(0);
            return;
        }
        setRetryCountdown(secs);
        const id = setInterval(() => {
            setRetryCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(id);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    }, [error]);

    const remainingChars = microcopy.ai.characterCounterMax - input.length;
    const showCounter = input.length >= microcopy.ai.characterCounterShowAfter;
    const counterIsWarning = remainingChars < 0;

    /**
     * Did this assistant turn consult any tools? Used to distinguish a
     * heuristic answer ("no sources" caveat) from a tool-backed answer
     * that simply returned no usable citations. Walks the messages between
     * this assistant turn and the previous user turn.
     */
    const assistantHadToolStep = useCallback(
        (assistantIndex: number) => {
            for (let i = assistantIndex - 1; i >= 0; i -= 1) {
                const m = messages[i];
                if (m.role === "user") return false;
                if (m.role === "tool") return true;
            }
            return false;
        },
        [messages]
    );

    /**
     * Screen-reader announcement for the most recently *completed*
     * assistant turn (AI UX best practices §2.10). Streaming bubbles
     * render with `aria-live="off"` so character-by-character updates
     * don't flood assistive tech; once `isLoading` flips back to false we
     * publish a short completion notice here so users know to navigate
     * to the bubble. We deliberately do *not* mirror the answer text in
     * this region — duplicating the bubble would make SR users hear the
     * answer twice (once via this region, once when they navigate to the
     * bubble) and would complicate text queries in tests.
     *
     * `messages` is read through a ref so the effect only fires on the
     * `isLoading` transition. Listing `messages` in the dep array would
     * re-run this on every streamed token (~100 invocations per answer)
     * even though we only care about the loading→idle flip.
     */
    const [completionAnnouncement, setCompletionAnnouncement] = useState("");
    const wasLoadingRef = useRef(false);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
            // Walk messages in reverse without copying the array.
            const turns = messagesRef.current;
            for (let i = turns.length - 1; i >= 0; i -= 1) {
                if (turns[i].role !== "assistant") continue;
                const wordCount = turns[i].content
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length;
                const template =
                    wordCount === 1
                        ? (microcopy.ai.completionAnnouncementOne as string)
                        : (microcopy.ai.completionAnnouncementOther as string);
                setCompletionAnnouncement(
                    template
                        .replace("{label}", String(microcopy.ai.copilotLabel))
                        .replace("{count}", String(wordCount))
                );
                break;
            }
        }
        wasLoadingRef.current = isLoading;
    }, [isLoading]);

    return (
        <Drawer
            extra={
                <Space size={space.xs}>
                    <CopilotPrivacyPopover route="chat" />
                    <Button
                        aria-label={microcopy.ai.newConversation}
                        disabled={messages.length === 0 || isLoading}
                        onClick={resetAll}
                        size="small"
                        type="link"
                    >
                        {microcopy.ai.newConversation}
                    </Button>
                </Space>
            }
            onClose={handleClose}
            open={open}
            size={drawerWidth}
            styles={{
                body: {
                    /* Quiet brand-accent breath at the top of the drawer
                     * body so the AI surface reads as distinct from a
                     * generic dialog. Uses `--aurora-blob-faint` so a
                     * palette swap re-tints in one shot. The glass
                     * drawer surface (App.css) carries the rest of the
                     * visual weight. */
                    background:
                        "radial-gradient(60% 30% at 50% 0%, var(--aurora-blob-faint) 0%, transparent 70%), transparent",
                    display: "flex",
                    flexDirection: "column",
                    paddingBottom: `max(${space.md}px, env(safe-area-inset-bottom))`,
                    paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                    paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`
                }
            }}
            title={
                <Space align="center" size={space.xs} wrap>
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: fontWeight.semibold }}>
                        {microcopy.ai.askCopilot}
                    </span>
                    <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                    <EngineModeTag />
                </Space>
            }
        >
            <CopilotRemoteConsentNotice route="chat" />
            {/*
             * Off-screen aria-live region (AI UX best practices §2.10).
             * Streaming text updates are silenced inside the visible
             * transcript; this region announces only the final assistant
             * turn (truncated to a sentence) so screen-reader users hear
             * the response once at completion instead of every token.
             */}
            <div
                aria-atomic="true"
                aria-live="polite"
                role="status"
                style={{
                    border: 0,
                    clip: "rect(0 0 0 0)",
                    height: 1,
                    margin: -1,
                    overflow: "hidden",
                    padding: 0,
                    position: "absolute",
                    width: 1
                }}
            >
                {completionAnnouncement}
            </div>
            <div
                aria-busy={isLoading}
                style={{
                    flex: "1 1 auto",
                    marginBottom: space.sm,
                    minHeight: 0,
                    overflowY: "auto",
                    overscrollBehavior: "contain"
                }}
            >
                {messages.length === 0 && !isLoading && (
                    <Space
                        size={space.sm}
                        style={{ width: "100%", flexDirection: "column" }}
                    >
                        <Text type="secondary">
                            {microcopy.ai.emptyChatLead}
                        </Text>
                        <Space size={space.xs} wrap>
                            {microcopy.ai.chatSuggestions.map((prompt) => (
                                <SamplePrompt
                                    aria-label={`Try sample prompt: ${prompt}`}
                                    checked={false}
                                    key={prompt}
                                    onChange={() => dispatch(prompt)}
                                >
                                    {prompt}
                                </SamplePrompt>
                            ))}
                        </Space>
                    </Space>
                )}
                {messages.map((m, index) => {
                    if (
                        m.role === "assistant" &&
                        !m.content.trim() &&
                        (m.toolCalls?.length ?? 0) > 0
                    ) {
                        // Hidden tool-call replay turn: useAiChat appends an
                        // assistant message with `toolCalls` and empty
                        // `content` before executing the tool calls so the
                        // remote LLM keeps multi-round context. The user-
                        // facing transcript still reads {user → tool result
                        // → final assistant text}; rendering this turn
                        // would surface the model's internal "I will call
                        // listTasks" step as a blank bubble.
                        return null;
                    }
                    if (m.role === "tool") {
                        // C-R11: render tool calls collapsed by default with a
                        // human-readable summary instead of raw JSON.
                        return (
                            <ToolDetails key={`tool-${m.toolCallId ?? index}`}>
                                <summary>
                                    {`${humanizeTool(m.toolName)} · ${summarizeToolBody(m.content)}`}
                                </summary>
                                <pre
                                    style={{
                                        fontSize: fontSize.xs - 1,
                                        margin: `${space.xxs}px 0 0`,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word"
                                    }}
                                >
                                    {m.content}
                                </pre>
                            </ToolDetails>
                        );
                    }
                    const isUser = m.role === "user";
                    const isAssistant = m.role === "assistant";
                    const turnFeedback = feedback.find(
                        (entry) => entry.index === index
                    );
                    const isRegenerated =
                        isAssistant && regeneratedIndices.has(index);
                    const groupAriaLabel = isAssistant
                        ? isRegenerated
                            ? `${microcopy.ai.copilotLabel} · ${microcopy.ai.regeneratedBadge}`
                            : microcopy.ai.copilotLabel
                        : undefined;
                    return (
                        <MessageRow
                            $isUser={isUser}
                            key={`msg-${index}`}
                            aria-label={groupAriaLabel}
                            role={isAssistant ? "group" : undefined}
                        >
                            {isAssistant && (
                                <AssistantAttribution>
                                    <AiSparkleIcon aria-hidden />
                                    <span>{microcopy.ai.copilotLabel}</span>
                                    {isRegenerated && (
                                        <Tooltip
                                            title={
                                                microcopy.ai.regeneratedTooltip
                                            }
                                        >
                                            <Tag
                                                color="purple"
                                                style={{
                                                    marginInlineStart: 4,
                                                    marginInlineEnd: 0
                                                }}
                                            >
                                                <ReloadOutlined
                                                    aria-hidden
                                                    style={{
                                                        fontSize:
                                                            fontSize.xs - 1,
                                                        marginInlineEnd: 4
                                                    }}
                                                />
                                                {microcopy.ai.regeneratedBadge}
                                            </Tag>
                                        </Tooltip>
                                    )}
                                </AssistantAttribution>
                            )}
                            <MessageBubble $isUser={isUser}>
                                {m.content}
                                {isAssistant &&
                                    m.citations &&
                                    m.citations.length > 0 &&
                                    (() => {
                                        const all = m.citations;
                                        const isExpanded =
                                            expandedCitations.has(index);
                                        const showAll =
                                            isExpanded ||
                                            all.length <= CITATION_INLINE_LIMIT;
                                        const visible = showAll
                                            ? all
                                            : all.slice(
                                                  0,
                                                  CITATION_INLINE_LIMIT
                                              );
                                        const overflow =
                                            all.length - visible.length;
                                        return (
                                            <span
                                                style={{
                                                    display: "inline-block",
                                                    marginInlineStart: 6
                                                }}
                                            >
                                                {visible.map(
                                                    (citation, idx) => (
                                                        <CitationChip
                                                            citation={citation}
                                                            index={idx + 1}
                                                            key={`${citation.source}-${citation.id}-${idx}`}
                                                        />
                                                    )
                                                )}
                                                {overflow > 0 && (
                                                    /*
                                                     * Show-more affordance for
                                                     * citation-heavy answers
                                                     * (P0-3 / AI UX best
                                                     * practices §2.9): keep
                                                     * the inline chip rail
                                                     * scannable, but never
                                                     * hide a source from
                                                     * verification — one
                                                     * click reveals the rest
                                                     * inline rather than
                                                     * sending the user to a
                                                     * separate dialog.
                                                     */
                                                    <Button
                                                        aria-label={`Show all ${all.length} sources`}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            expandCitations(
                                                                index
                                                            );
                                                        }}
                                                        size="small"
                                                        style={{
                                                            color: "var(--color-copilot-badge, #EA580C)",
                                                            fontSize:
                                                                fontSize.xs,
                                                            height: "auto",
                                                            marginInlineStart: 4,
                                                            paddingInline: 0,
                                                            verticalAlign:
                                                                "super"
                                                        }}
                                                        type="link"
                                                    >
                                                        {`+${overflow} more`}
                                                    </Button>
                                                )}
                                            </span>
                                        );
                                    })()}
                            </MessageBubble>
                            {isAssistant &&
                                m.citations !== undefined &&
                                m.citations.length === 0 &&
                                !assistantHadToolStep(index) && (
                                    /*
                                     * No-source caveat (Optimization Plan
                                     * §3 P0-3). When the assistant answered
                                     * without consulting any read-only tool
                                     * we say so explicitly so absence of a
                                     * chip is informative, not a missing
                                     * affordance the user has to interpret.
                                     */
                                    <Typography.Text
                                        style={{
                                            color: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45))",
                                            display: "block",
                                            fontSize: fontSize.xs,
                                            marginTop: 2
                                        }}
                                        type="secondary"
                                    >
                                        {microcopy.ai.chatNoSourcesCaveat}
                                    </Typography.Text>
                                )}
                            {isAssistant && (
                                <AssistantDisclaimer>
                                    {microcopy.a11y.aiBadge}
                                </AssistantDisclaimer>
                            )}
                            {isAssistant && !isLoading && (
                                <Space
                                    size={4}
                                    style={{
                                        display: "block",
                                        marginTop: 4,
                                        textAlign: "left"
                                    }}
                                >
                                    <Button
                                        aria-label="Regenerate response"
                                        icon={<ReloadOutlined aria-hidden />}
                                        onClick={() => handleRegenerate(index)}
                                        size="small"
                                        type="text"
                                    />
                                    <Button
                                        aria-label="Helpful answer"
                                        aria-pressed={
                                            turnFeedback?.value === "up"
                                        }
                                        onClick={() => handleThumbsUp(index)}
                                        size="small"
                                        type={
                                            turnFeedback?.value === "up"
                                                ? "primary"
                                                : "text"
                                        }
                                    >
                                        👍
                                    </Button>
                                    <AiFeedbackPopover
                                        onOpenChange={(next) =>
                                            handleFeedbackPopoverChange(
                                                index,
                                                next
                                            )
                                        }
                                        onSkip={() =>
                                            handleSkipFeedbackDown(index)
                                        }
                                        onSubmit={(submission) =>
                                            handleSubmitFeedbackDown(
                                                index,
                                                submission
                                            )
                                        }
                                        open={feedbackOpenFor === index}
                                    >
                                        <Tooltip
                                            /*
                                             * Surface the "what feedback
                                             * actually does" copy on hover so
                                             * users know up front their
                                             * message text is not sent
                                             * (Optimization Plan §3 P1-3).
                                             * Previously this disclaimer was
                                             * buried inside the popover —
                                             * users had to commit to the
                                             * thumbs-down click to see it.
                                             */
                                            title={
                                                microcopy.ai
                                                    .feedbackThumbsDownTooltip
                                            }
                                        >
                                            <Button
                                                aria-expanded={
                                                    feedbackOpenFor === index
                                                }
                                                aria-haspopup="dialog"
                                                aria-label="Not helpful — give feedback"
                                                aria-pressed={
                                                    turnFeedback?.value ===
                                                    "down"
                                                }
                                                onClick={() =>
                                                    handleThumbsDownClick(index)
                                                }
                                                size="small"
                                                type={
                                                    turnFeedback?.value ===
                                                    "down"
                                                        ? "primary"
                                                        : "text"
                                                }
                                            >
                                                👎
                                            </Button>
                                        </Tooltip>
                                    </AiFeedbackPopover>
                                </Space>
                            )}
                        </MessageRow>
                    );
                })}
                {/* C-R5: re-show contextual sample prompts after each turn so
                    the user always has a quick next-step. */}
                {!isLoading && messages.length > 0 && (
                    <Space
                        size={space.xs}
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            marginTop: space.xs
                        }}
                    >
                        {microcopy.ai.chatSuggestions
                            .slice(0, 2)
                            .map((prompt) => (
                                <SamplePrompt
                                    aria-label={`Try follow-up: ${prompt}`}
                                    checked={false}
                                    key={prompt}
                                    onChange={() => dispatch(prompt)}
                                >
                                    {prompt}
                                </SamplePrompt>
                            ))}
                    </Space>
                )}
                {isLoading && (
                    <MessageRow
                        $isUser={false}
                        aria-label={`${microcopy.ai.copilotLabel} · ${microcopy.ai.streaming}`}
                        role="group"
                    >
                        <AssistantAttribution>
                            <AiSparkleIcon aria-hidden />
                            <span>{microcopy.ai.copilotLabel}</span>
                            {!streamingText && (
                                /* Pre-token stage label sits next to the model
                                   name so users see *something* descriptive
                                   before the first character lands. Once the
                                   bubble has its own streaming text, hide
                                   this label to avoid duplicating the same
                                   string in two places. */
                                <Text
                                    style={{
                                        color: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45))",
                                        fontSize: fontSize.xs,
                                        fontWeight: fontWeight.regular,
                                        marginInlineStart: 4
                                    }}
                                    type="secondary"
                                >
                                    {microcopy.ai.thinkingDefault}
                                </Text>
                            )}
                        </AssistantAttribution>
                        {/*
                         * `aria-live="off"` (AI UX best practices §2.10):
                         * the streaming bubble updates token-by-token and
                         * would otherwise drown screen readers in mid-word
                         * announcements. The visible cursor + text still
                         * works for sighted users; the dedicated
                         * `completionAnnouncement` live region above
                         * announces the final answer once.
                         */}
                        <MessageBubble $isUser={false} aria-live="off">
                            {streamingText ? (
                                <>
                                    {streamingText}
                                    <StreamingCursor aria-hidden>
                                        ▍
                                    </StreamingCursor>
                                </>
                            ) : (
                                <Skeleton
                                    active
                                    aria-label={microcopy.ai.streaming}
                                    paragraph={{
                                        rows: 2,
                                        width: ["80%", "55%"]
                                    }}
                                    title={false}
                                />
                            )}
                        </MessageBubble>
                        <AssistantDisclaimer>
                            {microcopy.a11y.aiBadge}
                        </AssistantDisclaimer>
                    </MessageRow>
                )}
            </div>

            {errorView && (
                <Alert
                    action={
                        errorView.retryable ? (
                            <Button
                                disabled={retryCountdown > 0}
                                onClick={() => {
                                    const lastUser = [...messages]
                                        .reverse()
                                        .find((m) => m.role === "user");
                                    if (lastUser) dispatch(lastUser.content);
                                }}
                                size="small"
                                type="link"
                            >
                                {retryCountdown > 0
                                    ? `${microcopy.ai.retryLabel} (${retryCountdown}s)`
                                    : microcopy.ai.retryLabel}
                            </Button>
                        ) : null
                    }
                    closable
                    description={errorView.body || undefined}
                    onClose={dismissError}
                    showIcon
                    style={{ marginBottom: space.xs }}
                    title={errorView.heading}
                    type={errorView.severity}
                />
            )}

            <Space.Compact style={{ width: "100%" }}>
                <Input.TextArea
                    aria-label={microcopy.a11y.messageBoardCopilot}
                    autoComplete="off"
                    autoSize={{ maxRows: 4, minRows: 1 }}
                    disabled={isLoading}
                    enterKeyHint="send"
                    inputMode="text"
                    maxLength={microcopy.ai.characterCounterMax}
                    onChange={(e) => setInput(e.target.value)}
                    onPressEnter={(e) => {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={microcopy.placeholders.chatAsk}
                    ref={inputRef}
                    value={input}
                />
                {isLoading ? (
                    <Button
                        aria-label={microcopy.ai.stopResponse}
                        danger
                        icon={<StopOutlined aria-hidden />}
                        onClick={() => abort()}
                        type="default"
                    >
                        {microcopy.actions.stop}
                    </Button>
                ) : (
                    <Button
                        aria-label={microcopy.a11y.sendMessage}
                        disabled={!input.trim()}
                        onClick={handleSend}
                        type="primary"
                    >
                        {microcopy.actions.send}
                    </Button>
                )}
            </Space.Compact>
            {showCounter && (
                <div
                    style={{
                        color: counterIsWarning
                            ? "var(--ant-color-error, #EF4444)"
                            : "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65))",
                        fontSize: fontSize.xs,
                        marginTop: 4,
                        textAlign: "right"
                    }}
                >
                    {input.length} / {microcopy.ai.characterCounterMax}
                </div>
            )}
        </Drawer>
    );
};

export default AiChatDrawer;
