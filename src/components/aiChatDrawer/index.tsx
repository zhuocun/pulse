import {
    CheckOutlined,
    CopyOutlined,
    EditOutlined,
    PlusOutlined,
    ReloadOutlined
} from "@ant-design/icons";
import {
    Alert,
    App,
    Button,
    Drawer,
    Grid,
    Modal,
    Select,
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
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import {
    QueryClient,
    QueryClientContext,
    QueryClientProvider
} from "@tanstack/react-query";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { AgentBudgetError } from "../../utils/ai/agentErrors";
import {
    loadChatHistory,
    saveChatHistory
} from "../../utils/ai/projectAiStorage";
import useAiChat from "../../utils/hooks/useAiChat";
import useAgentChat from "../../utils/hooks/useAgentChat";
import useAgentHealth from "../../utils/hooks/useAgentHealth";
import { useAutonomyLevel } from "../../utils/hooks/useAiEnabled";
import useChatAgentMetadata from "../../utils/hooks/useChatAgentMetadata";
import useDelayedFlag from "../../utils/hooks/useDelayedFlag";
import type {
    AutonomyLevel,
    MutationProposal,
    TriageNudge
} from "../../interfaces/agent";
import AiFeedbackPopover, {
    type AiFeedbackSubmission
} from "../aiFeedbackPopover";
import AiSparkleIcon from "../aiSparkleIcon";
import CitationChip from "../citationChip";
import CopilotAboutPopover from "../copilotAboutPopover";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import EngineModeTag from "../engineModeTag";
import MutationProposalCard from "../mutationProposalCard";
import NudgeCard from "../nudgeCard";
import { AiChatComposer } from "./AiChatComposer";
import {
    AssistantAttribution,
    AssistantDisclaimer,
    MessageBubble,
    MessageRow,
    SamplePrompt,
    StreamingCursor,
    ToolPayloadPanel
} from "./aiChatDrawerStyles";
import {
    BUDGET_CRITICAL_THRESHOLD,
    BUDGET_WARN_THRESHOLD,
    CITATION_INLINE_LIMIT,
    humanizeTool,
    summarizeToolBody
} from "./aiChatToolDisplay";

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
    /**
     * v2.1 mount point: an active MutationProposal emitted by the agent
     * stream. Rendered inline between messages when present.
     */
    pendingProposal?: MutationProposal;
    /**
     * v2.1 mount point: active TriageNudges emitted by the agent stream.
     * Rendered inline between messages when non-empty.
     */
    pendingNudges?: TriageNudge[];
    /**
     * Called when the user clicks Apply on a MutationProposalCard. Owners
     * typically call `agent.resume({ accepted: true })` and clear the
     * pending proposal. When omitted the drawer hides the card locally so
     * the user always has a way out.
     */
    onAcceptProposal?: (proposal: MutationProposal) => void;
    /**
     * Called when the user rejects a MutationProposalCard. Mirror of
     * `onAcceptProposal`; owners typically call `agent.resume({ accepted:
     * false })`.
     */
    onRejectProposal?: (proposal: MutationProposal) => void;
    /**
     * Called when the user clicks the primary CTA on a NudgeCard. Owners
     * navigate or kick off a follow-up agent run.
     */
    onActionNudge?: (nudge: TriageNudge) => void;
    /**
     * Called when the user dismisses a NudgeCard. When omitted the drawer
     * hides the card locally for the lifetime of the open drawer.
     */
    onDismissNudge?: (nudge: TriageNudge) => void;
}

/**
 * Fallback QueryClient used when the drawer is rendered outside a
 * QueryClientProvider (e.g. in legacy tests or Storybook sandboxes).
 * This avoids a hard crash from `useQueryClient()` inside `useAgentChat` →
 * `useAgent` while keeping the remote path disabled (local engine only).
 */
const fallbackQueryClient = new QueryClient();

const AiChatDrawerInner: React.FC<AiChatDrawerProps> = ({
    open,
    onClose,
    project,
    columns,
    tasks,
    members,
    knownProjectIds,
    initialPrompt,
    pendingProposal,
    pendingNudges,
    onAcceptProposal,
    onRejectProposal,
    onActionNudge,
    onDismissNudge
}) => {
    const chatMeta = useChatAgentMetadata();
    const allowedAutonomy = useMemo(
        () =>
            chatMeta.status === "ready"
                ? chatMeta.data.allowed_autonomy
                : undefined,
        [chatMeta]
    );
    const autonomySelectorOptions = useMemo(() => {
        const base: Array<{
            value: AutonomyLevel;
            labelKey: string;
            disabledTooltipKey?: string;
        }> = [
            { value: "suggest", labelKey: "autonomyLevelSuggest" },
            { value: "plan", labelKey: "autonomyLevelPlan" },
            {
                value: "auto",
                labelKey: "autonomyLevelAuto",
                disabledTooltipKey: "autonomyAutoDisabledTooltip"
            }
        ];
        const visible =
            chatMeta.status === "ready"
                ? base.filter((o) =>
                      chatMeta.data.allowed_autonomy.includes(o.value)
                  )
                : base;
        return visible.map((o) => {
            if (o.value !== "auto") {
                return { ...o, disabled: false as boolean | undefined };
            }
            const mutationsOk = environment.aiMutationProposalsEnabled;
            const serverAllowsAuto =
                chatMeta.status !== "ready" ||
                chatMeta.data.allowed_autonomy.includes("auto");
            return {
                ...o,
                disabled: !mutationsOk || !serverAllowsAuto
            };
        });
    }, [chatMeta]);
    const { level: autonomyLevel, setLevel: setAutonomyLevel } =
        useAutonomyLevel(allowedAutonomy);
    const remoteHealthEnabled =
        environment.aiEnabled && !environment.aiUseLocalEngine;
    const { status: healthStatus } = useAgentHealth(
        environment.aiBaseUrl ?? "",
        {
            agentName: "chat-agent",
            enabled: remoteHealthEnabled
        }
    );
    const [input, setInput] = useState("");
    const [feedback, setFeedback] = useState<ChatTurnFeedback[]>([]);
    /** P2-E: tracks which assistant messages are expanded (prose > 300 words). */
    const [expandedMessages, setExpandedMessages] = useState<Set<number>>(
        () => new Set()
    );
    /** P2-A: screen-reader announcement for streaming state. */
    const [streamingAnnouncement, setStreamingAnnouncement] = useState("");
    /** P2-D: whether to show the scroll-to-bottom FAB. */
    const [showScrollFab, setShowScrollFab] = useState(false);
    /** P2-D: ref for the messages scroll container. */
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    /** P2-B: ref for the last assistant message for focus management. */
    const lastAssistantRef = useRef<HTMLDivElement | null>(null);
    /** When true, the next loading→idle transition focuses the assistant bubble. */
    const shouldFocusAssistantOnCompleteRef = useRef(false);
    const prevIsLoadingRef = useRef(false);
    /** P1-C: whether the budget warn alert has been dismissed by user. */
    const [budgetWarnDismissed, setBudgetWarnDismissed] = useState(false);

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
    /** Per-index clock labels for transcript rows (approximate display time). */
    const [messageTimes, setMessageTimes] = useState<number[]>([]);
    /** Which `tool` transcript rows have an expanded raw payload panel. */
    const [expandedToolIndices, setExpandedToolIndices] = useState<Set<number>>(
        () => new Set()
    );
    /** Assistant turn index recently copied — briefly swap icon to a checkmark. */
    const [copyConfirmedAssistantIndex, setCopyConfirmedAssistantIndex] =
        useState<number | null>(null);
    const copyConfirmClearRef = useRef<number | null>(null);

    /**
     * Local dismissal tracking for v2.1 cards. Owners that pass
     * `onAcceptProposal` / `onDismissNudge` are expected to clear the
     * `pendingProposal` / `pendingNudges` props themselves. When no
     * callback is supplied the drawer still needs to give the user a way
     * out, so we hide the card locally for the lifetime of the open
     * drawer. State resets when the proposal id changes or the drawer
     * closes so a fresh proposal is never silently suppressed.
     */
    const [localProposalHandled, setLocalProposalHandled] = useState(false);
    const [locallyDismissedNudges, setLocallyDismissedNudges] = useState<
        Set<string>
    >(() => new Set());

    const expandCitations = useCallback((turnIndex: number) => {
        setExpandedCitations((prev) => {
            if (prev.has(turnIndex)) return prev;
            const next = new Set(prev);
            next.add(turnIndex);
            return next;
        });
    }, []);

    const toggleToolPayload = useCallback((turnIndex: number) => {
        setExpandedToolIndices((prev) => {
            const next = new Set(prev);
            if (next.has(turnIndex)) next.delete(turnIndex);
            else next.add(turnIndex);
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
    /**
     * Tracks which project id has already had its localStorage history
     * restored. Prevents re-seeding after the user starts a new conversation
     * (reset clears messages but the project id stays the same).
     */
    const historyRestoredForRef = useRef<string | null>(null);
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

    // Mount BOTH hooks; only one drives the UI based on aiUseLocalEngine.
    // The inactive hook receives null ctx so it doesn't fire any requests.
    const localChat = useAiChat(
        environment.aiUseLocalEngine && open ? chatCtx : null
    );
    const agentChat = useAgentChat(
        !environment.aiUseLocalEngine && open ? chatCtx : null,
        { allowedAutonomy }
    );

    // Pick the active result — one object so render code stays branch-free.
    const {
        abort,
        dismissError,
        error,
        isLoading,
        messages,
        reset,
        seedMessages,
        send,
        streamingText
    } = environment.aiUseLocalEngine ? localChat : agentChat;

    /**
     * F-1 restore: on first open for a given project, seed the active hook
     * with any history saved to localStorage. We only seed once per project
     * per drawer mount so that a user's "New conversation" reset is not
     * immediately undone by a re-seed.
     */
    useEffect(() => {
        if (!open || !project?._id) return;
        if (historyRestoredForRef.current === project._id) return;
        historyRestoredForRef.current = project._id;
        const saved = loadChatHistory(project._id).filter(
            (m) =>
                (m.role === "user" ||
                    m.role === "assistant" ||
                    m.role === "tool") &&
                typeof m.content === "string"
        );
        if (saved.length > 0) {
            seedMessages(saved);
        }
    }, [open, project?._id, seedMessages]);

    useEffect(() => {
        setMessageTimes((prev) => {
            if (messages.length === 0) return [];
            const next = prev.slice(0, messages.length);
            const now = Date.now();
            for (let i = 0; i < messages.length; i += 1) {
                if (next[i] === undefined) {
                    next[i] = now - (messages.length - 1 - i) * 1000;
                }
            }
            return next;
        });
    }, [messages]);

    useEffect(
        () => () => {
            if (copyConfirmClearRef.current !== null) {
                window.clearTimeout(copyConfirmClearRef.current);
            }
        },
        []
    );

    useEffect(() => {
        setLocalProposalHandled(false);
    }, [pendingProposal?.proposal_id, agentChat.pendingProposal?.proposal_id]);

    useEffect(() => {
        if (!open) {
            setLocalProposalHandled(false);
            setLocallyDismissedNudges(new Set());
        }
    }, [open]);

    // Resolve the effective proposal and nudges for the drawer.
    // Parent-supplied props are authoritative; when absent and remote v2.1 is
    // active, pull from the agent adapter.
    const isRemote = !environment.aiUseLocalEngine;
    const effectivePendingProposal =
        pendingProposal !== undefined
            ? pendingProposal
            : isRemote
              ? (agentChat.pendingProposal ?? undefined)
              : undefined;
    const effectivePendingNudges =
        pendingNudges !== undefined
            ? pendingNudges
            : isRemote
              ? agentChat.pendingNudges
              : undefined;

    const handleAcceptProposal = useCallback(
        (proposal: MutationProposal) => {
            if (onAcceptProposal) {
                onAcceptProposal(proposal);
                return;
            }
            if (isRemote) {
                agentChat.resumeProposal(true);
                return;
            }
            setLocalProposalHandled(true);
        },
        [agentChat, isRemote, onAcceptProposal]
    );

    const handleRejectProposal = useCallback(
        (proposal: MutationProposal) => {
            if (onRejectProposal) {
                onRejectProposal(proposal);
                return;
            }
            if (isRemote) {
                agentChat.resumeProposal(false);
                return;
            }
            setLocalProposalHandled(true);
        },
        [agentChat, isRemote, onRejectProposal]
    );

    const handleNudgeAction = useCallback(
        (nudge: TriageNudge) => {
            onActionNudge?.(nudge);
        },
        [onActionNudge]
    );

    const handleNudgeDismiss = useCallback(
        (nudge: TriageNudge) => {
            if (onDismissNudge) {
                onDismissNudge(nudge);
                return;
            }
            if (isRemote) {
                agentChat.dismissNudge(nudge.nudge_id);
                return;
            }
            setLocallyDismissedNudges((prev) => {
                if (prev.has(nudge.nudge_id)) return prev;
                const next = new Set(prev);
                next.add(nudge.nudge_id);
                return next;
            });
        },
        [agentChat, isRemote, onDismissNudge]
    );

    const visibleProposal =
        effectivePendingProposal && !localProposalHandled
            ? effectivePendingProposal
            : null;
    const visibleNudges = (effectivePendingNudges ?? []).filter(
        (nudge) => !locallyDismissedNudges.has(nudge.nudge_id)
    );

    /** Reset the local UI state too (feedback, citations) on hard reset. */
    const resetAll = useCallback(() => {
        reset();
        setFeedback([]);
        setRegeneratedIndices(new Set());
        setExpandedCitations(new Set());
        setExpandedMessages(new Set());
        setMessageTimes([]);
        setExpandedToolIndices(new Set());
        setBudgetWarnDismissed(false);
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
        shouldFocusAssistantOnCompleteRef.current = true;
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

    // P1-C: approximate token count for context-window budget warnings.
    const approxTokenCount = messages.reduce(
        (acc, m) => acc + Math.ceil(m.content.length / 4),
        0
    );

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

    /**
     * P2-I: Track elapsed ms while in the pre-token loading phase so we can
     * show "Still thinking…" after 3 s without a first token.
     */
    const [loadingMs, setLoadingMs] = useState(0);
    useEffect(() => {
        if (!isLoading) {
            setLoadingMs(0);
            return;
        }
        const id = setInterval(() => {
            setLoadingMs((prev) => prev + 1000);
        }, 1000);
        return () => clearInterval(id);
    }, [isLoading]);

    const clockFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "numeric"
            }),
        []
    );

    const formatClock = useCallback(
        (epochMs: number) => clockFormatter.format(new Date(epochMs)),
        [clockFormatter]
    );

    const messageTimeAt = useCallback(
        (index: number) => messageTimes[index] ?? Date.now(),
        [messageTimes]
    );

    const promptCharMax = microcopy.ai.characterCounterMax;
    const promptCharHintText = microcopyString(
        microcopy.ai.characterCountTemplate
    )
        .replace("{count}", String(input.length))
        .replace("{max}", String(promptCharMax));
    const promptCharHintWarning = input.length > promptCharMax * 0.9;

    const showDelayedLoadingBubble = useDelayedFlag(
        isLoading && !streamingText,
        250
    );

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
                        ? microcopyString(
                              microcopy.ai.completionAnnouncementOne
                          )
                        : microcopyString(
                              microcopy.ai.completionAnnouncementOther
                          );
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

    /**
     * P2-A: Announce "Board Copilot is responding." when streaming starts
     * and clear it on completion (the completion region handles success).
     */
    useEffect(() => {
        if (isLoading) {
            setStreamingAnnouncement(
                microcopyString(microcopy.ai.chatResponding)
            );
        } else {
            setStreamingAnnouncement("");
        }
    }, [isLoading]);

    /**
     * P2-B: After streaming completes, keep focus on the composer when the
     * user is composing a follow-up. Only move focus to the last assistant
     * bubble after an explicit Regenerate; completion announcements still
     * notify screen-reader users without stealing the text field.
     */
    useEffect(() => {
        const wasLoading = prevIsLoadingRef.current;
        prevIsLoadingRef.current = isLoading;

        if (!wasLoading || isLoading) return;

        if (
            shouldFocusAssistantOnCompleteRef.current &&
            lastAssistantRef.current
        ) {
            lastAssistantRef.current.focus();
            shouldFocusAssistantOnCompleteRef.current = false;
            return;
        }

        const composer = inputRef.current?.resizableTextArea?.textArea ?? null;
        if (composer !== null && document.activeElement === composer) {
            inputRef.current?.focus({ cursor: "end" });
        }
    }, [isLoading]);

    /**
     * P2-C (Phase B): persist history to localStorage whenever messages
     * change and we have a project ID. History is restored on open via the
     * seedMessages effect above.
     */
    useEffect(() => {
        if (project?._id && messages.length > 0) {
            saveChatHistory(project._id, messages);
        }
    }, [messages, project?._id]);

    const lastAssistantIndex = messages.reduceRight(
        (found, m, i) =>
            found === -1 && m.role === "assistant" && m.content.trim()
                ? i
                : found,
        -1
    );

    return (
        <Drawer
            extra={
                <Space size={space.xs}>
                    <Select
                        aria-label={microcopyString(
                            microcopy.ai.autonomySelectorAriaLabel
                        )}
                        onChange={(value: AutonomyLevel) =>
                            setAutonomyLevel(value)
                        }
                        options={autonomySelectorOptions.map((opt) => {
                            const labelText = microcopyString(
                                microcopy.ai[
                                    opt.labelKey as keyof typeof microcopy.ai
                                ]
                            );
                            const tooltip = opt.disabledTooltipKey
                                ? microcopyString(
                                      microcopy.ai[
                                          opt.disabledTooltipKey as keyof typeof microcopy.ai
                                      ]
                                  )
                                : undefined;
                            return {
                                value: opt.value,
                                disabled: opt.disabled,
                                /*
                                 * `title` fallback gives the disabled row
                                 * a native browser tooltip in addition to
                                 * the AntD `Tooltip` below — assistive
                                 * tech and keyboard users who can't hover
                                 * still get the explanation.
                                 */
                                title: opt.disabled ? tooltip : undefined,
                                /*
                                 * AntD Select renders `label` as the
                                 * dropdown row content. Wrapping the
                                 * disabled "Auto" row in a Tooltip
                                 * surfaces the "why disabled" copy on
                                 * hover without changing the collapsed
                                 * selector text. Non-disabled rows render
                                 * a plain string so `value` (active
                                 * selection display) is unaffected.
                                 */
                                label: opt.disabled ? (
                                    <Tooltip placement="left" title={tooltip}>
                                        <span
                                            data-testid={`autonomy-option-${opt.value}`}
                                        >
                                            {labelText}
                                        </span>
                                    </Tooltip>
                                ) : (
                                    labelText
                                )
                            };
                        })}
                        size="small"
                        style={{ minWidth: 90 }}
                        value={autonomyLevel}
                    />
                    <CopilotAboutPopover />
                    {screens.md && <CopilotPrivacyPopover route="chat" />}
                    <Tooltip
                        title={
                            !screens.md
                                ? microcopy.ai.newConversation
                                : undefined
                        }
                    >
                        <Button
                            aria-label={microcopy.ai.newConversation}
                            disabled={messages.length === 0 || isLoading}
                            icon={
                                !screens.md ? (
                                    <PlusOutlined aria-hidden />
                                ) : undefined
                            }
                            onClick={() => {
                                if (messages.length > 0) {
                                    Modal.confirm({
                                        content:
                                            microcopy.ai.newConversationConfirm,
                                        onOk: resetAll
                                    });
                                } else {
                                    resetAll();
                                }
                            }}
                            size="small"
                            type="link"
                        >
                            {screens.md ? microcopy.ai.newConversation : null}
                        </Button>
                    </Tooltip>
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
                    paddingBottom: `max(${space.md}px, env(keyboard-inset-height, 0px), env(safe-area-inset-bottom))`,
                    paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                    paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`
                }
            }}
            title={
                <Space align="center" size={space.xs}>
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: fontWeight.semibold }}>
                        {microcopy.ai.askCopilot}
                    </span>
                    {screens.md && (
                        <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                    )}
                    {screens.md && <EngineModeTag />}
                </Space>
            }
        >
            <CopilotRemoteConsentNotice route="chat" />
            {/* P2-G: Inline health status alert */}
            {remoteHealthEnabled &&
                (healthStatus === "degraded" || healthStatus === "offline") && (
                    <Alert
                        closable={healthStatus === "degraded"}
                        message={
                            healthStatus === "offline"
                                ? microcopy.ai.healthOffline
                                : microcopy.ai.healthDegraded
                        }
                        showIcon
                        style={{ marginBottom: space.sm }}
                        type={healthStatus === "offline" ? "error" : "warning"}
                    />
                )}
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
                    pointerEvents: "none",
                    position: "absolute",
                    width: 1
                }}
            >
                {completionAnnouncement}
            </div>
            {/* P2-A: Streaming state announcement for screen readers */}
            <div
                aria-live="polite"
                role="status"
                style={{
                    border: 0,
                    clip: "rect(0 0 0 0)",
                    height: 1,
                    margin: -1,
                    overflow: "hidden",
                    padding: 0,
                    pointerEvents: "none",
                    position: "absolute",
                    width: 1
                }}
            >
                {streamingAnnouncement}
            </div>
            {/* P2-D: relative wrapper for the scroll-to-bottom FAB */}
            <div
                style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}
            >
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- P2-B: Escape refocuses composer from scroll container */}
                <div
                    aria-busy={isLoading}
                    onKeyDown={(e) => {
                        /* P2-B: Escape from message area refocuses input */
                        if (e.key === "Escape") {
                            inputRef.current?.focus({ cursor: "end" });
                        }
                    }}
                    onScroll={() => {
                        /* P2-D: show FAB when user scrolls up during streaming */
                        const el = messagesContainerRef.current;
                        if (!el) return;
                        const atBottom =
                            el.scrollTop >=
                            el.scrollHeight - el.clientHeight - 100;
                        if (isLoading && !atBottom) {
                            setShowScrollFab(true);
                        } else {
                            setShowScrollFab(false);
                        }
                    }}
                    ref={messagesContainerRef}
                    style={{
                        height: "100%",
                        marginBottom: space.sm,
                        overflowY: "auto",
                        overscrollBehavior: "contain"
                    }}
                >
                    {/* P1-C: context-window budget warnings */}
                    {approxTokenCount >= BUDGET_CRITICAL_THRESHOLD ? (
                        <Alert
                            action={
                                <Button
                                    onClick={resetAll}
                                    size="small"
                                    type="link"
                                >
                                    {microcopy.ai.startNew}
                                </Button>
                            }
                            closable={false}
                            message={microcopy.ai.conversationTooLong}
                            showIcon
                            style={{ marginBottom: space.sm }}
                            type="error"
                        />
                    ) : approxTokenCount >= BUDGET_WARN_THRESHOLD &&
                      !budgetWarnDismissed ? (
                        <Alert
                            closable
                            message={microcopy.ai.conversationLongWarning}
                            onClose={() => setBudgetWarnDismissed(true)}
                            showIcon
                            style={{ marginBottom: space.sm }}
                            type="warning"
                        />
                    ) : null}
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
                                        aria-label={microcopy.a11y.trySamplePrompt.replace(
                                            "{prompt}",
                                            prompt
                                        )}
                                        checked={false}
                                        key={prompt}
                                        onChange={() => dispatch(prompt)}
                                    >
                                        {prompt}
                                    </SamplePrompt>
                                ))}
                            </Space>
                            {/* P2-C Phase A: sessions not persisted notice */}
                            <Text
                                type="secondary"
                                style={{ fontSize: fontSize.xs }}
                            >
                                {microcopy.ai.sessionNotSaved}
                            </Text>
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
                            const toolPayloadOpen =
                                expandedToolIndices.has(index);
                            const timeMs = messageTimeAt(index);
                            const toggleId = `chat-tool-toggle-${index}`;
                            const panelId = `chat-tool-payload-${index}`;
                            return (
                                <MessageRow
                                    $isUser={false}
                                    key={`tool-${m.toolCallId ?? index}`}
                                >
                                    <Text
                                        type="secondary"
                                        style={{
                                            display: "block",
                                            fontSize: fontSize.xs,
                                            marginBottom: 2
                                        }}
                                    >
                                        <time
                                            data-testid="tool-message-time"
                                            dateTime={new Date(
                                                timeMs
                                            ).toISOString()}
                                        >
                                            {formatClock(timeMs)}
                                        </time>
                                    </Text>
                                    <ToolPayloadPanel data-testid="chat-tool-payload-block">
                                        <div>
                                            {`${humanizeTool(m.toolName)} · ${summarizeToolBody(m.content)}`}
                                        </div>
                                        <Button
                                            aria-controls={panelId}
                                            aria-expanded={toolPayloadOpen}
                                            id={toggleId}
                                            onClick={() =>
                                                toggleToolPayload(index)
                                            }
                                            size="small"
                                            type="link"
                                        >
                                            {toolPayloadOpen
                                                ? microcopyString(
                                                      microcopy.ai
                                                          .toolDetailsHide
                                                  )
                                                : microcopyString(
                                                      microcopy.ai
                                                          .toolDetailsToggle
                                                  )}
                                        </Button>
                                        {toolPayloadOpen ? (
                                            <pre
                                                aria-labelledby={toggleId}
                                                id={panelId}
                                                role="region"
                                                style={{
                                                    fontSize: fontSize.xs - 1,
                                                    margin: `${space.xxs}px 0 0`,
                                                    whiteSpace: "pre-wrap",
                                                    wordBreak: "break-word"
                                                }}
                                            >
                                                {m.content}
                                            </pre>
                                        ) : null}
                                    </ToolPayloadPanel>
                                </MessageRow>
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
                        // P2-E: progressive disclosure for long prose responses
                        const wordCount = m.content
                            .split(/\s+/)
                            .filter(Boolean).length;
                        const isProseLong =
                            isAssistant &&
                            wordCount > 300 &&
                            !/^[#\-*]/.test(m.content.trim());
                        const isExpanded = expandedMessages.has(index);
                        // P3-B: simple inline markdown renderer for assistant messages
                        const renderMarkdown = (
                            text: string
                        ): React.ReactNode => {
                            const lines = text.split("\n");
                            return lines.map((line, li) => {
                                // Heading
                                if (/^### /.test(line)) {
                                    return (
                                        <h3
                                            key={li}
                                            style={{
                                                fontSize: fontSize.sm,
                                                fontWeight: fontWeight.semibold,
                                                margin: `${space.xs}px 0 ${space.xxs}px`
                                            }}
                                        >
                                            {line.replace(/^### /, "")}
                                        </h3>
                                    );
                                }
                                if (/^## /.test(line)) {
                                    return (
                                        <h3
                                            key={li}
                                            style={{
                                                fontSize: fontSize.sm,
                                                fontWeight: fontWeight.semibold,
                                                margin: `${space.xs}px 0 ${space.xxs}px`
                                            }}
                                        >
                                            {line.replace(/^## /, "")}
                                        </h3>
                                    );
                                }
                                if (/^# /.test(line)) {
                                    return (
                                        <h3
                                            key={li}
                                            style={{
                                                fontSize: fontSize.sm,
                                                fontWeight: fontWeight.semibold,
                                                margin: `${space.xs}px 0 ${space.xxs}px`
                                            }}
                                        >
                                            {line.replace(/^# /, "")}
                                        </h3>
                                    );
                                }
                                // Parse inline formatting (bold, italic, code)
                                const parts: React.ReactNode[] = [];
                                let remaining = line;
                                let key = 0;
                                while (remaining.length > 0) {
                                    const boldMatch =
                                        remaining.match(/^(.*?)\*\*(.*?)\*\*/);
                                    const italicMatch =
                                        remaining.match(/^(.*?)\*(.*?)\*/);
                                    const codeMatch =
                                        remaining.match(/^(.*?)`([^`]+)`/);
                                    const firstBold = boldMatch
                                        ? boldMatch.index! + boldMatch[1].length
                                        : Infinity;
                                    const firstItalic = italicMatch
                                        ? italicMatch.index! +
                                          italicMatch[1].length
                                        : Infinity;
                                    const firstCode = codeMatch
                                        ? codeMatch.index! + codeMatch[1].length
                                        : Infinity;
                                    if (
                                        boldMatch &&
                                        firstBold <= firstItalic &&
                                        firstBold <= firstCode
                                    ) {
                                        if (boldMatch[1])
                                            parts.push(boldMatch[1]);
                                        parts.push(
                                            <strong key={key++}>
                                                {boldMatch[2]}
                                            </strong>
                                        );
                                        remaining = remaining.slice(
                                            boldMatch[0].length
                                        );
                                    } else if (
                                        italicMatch &&
                                        firstItalic <= firstCode
                                    ) {
                                        if (italicMatch[1])
                                            parts.push(italicMatch[1]);
                                        parts.push(
                                            <em key={key++}>
                                                {italicMatch[2]}
                                            </em>
                                        );
                                        remaining = remaining.slice(
                                            italicMatch[0].length
                                        );
                                    } else if (codeMatch) {
                                        if (codeMatch[1])
                                            parts.push(codeMatch[1]);
                                        parts.push(
                                            <code
                                                key={key++}
                                                style={{
                                                    background:
                                                        "var(--ant-color-fill-secondary)",
                                                    borderRadius: radius.sm,
                                                    fontSize: "0.9em",
                                                    padding: "1px 4px"
                                                }}
                                            >
                                                {codeMatch[2]}
                                            </code>
                                        );
                                        remaining = remaining.slice(
                                            codeMatch[0].length
                                        );
                                    } else {
                                        parts.push(remaining);
                                        remaining = "";
                                    }
                                }
                                return (
                                    <span key={li}>
                                        {parts}
                                        {li < lines.length - 1 && <br />}
                                    </span>
                                );
                            });
                        };
                        return (
                            <MessageRow
                                $isUser={isUser}
                                key={`msg-${index}`}
                                aria-label={groupAriaLabel}
                                ref={
                                    isAssistant && index === lastAssistantIndex
                                        ? lastAssistantRef
                                        : undefined
                                }
                                role={isAssistant ? "group" : undefined}
                                tabIndex={
                                    isAssistant && index === lastAssistantIndex
                                        ? -1
                                        : undefined
                                }
                            >
                                {isUser && (
                                    <Text
                                        type="secondary"
                                        style={{
                                            display: "block",
                                            fontSize: fontSize.xs,
                                            marginBottom: 2,
                                            maxWidth: "min(100%, 36rem)",
                                            textAlign: "right",
                                            width: "100%"
                                        }}
                                    >
                                        <time
                                            data-testid="user-message-time"
                                            dateTime={new Date(
                                                messageTimeAt(index)
                                            ).toISOString()}
                                        >
                                            {formatClock(messageTimeAt(index))}
                                        </time>
                                    </Text>
                                )}
                                {isAssistant && (
                                    <AssistantAttribution>
                                        <span
                                            style={{
                                                alignItems: "center",
                                                display: "inline-flex",
                                                flexWrap: "wrap",
                                                gap: 4
                                            }}
                                        >
                                            <AiSparkleIcon aria-hidden />
                                            <span>
                                                {microcopy.ai.copilotLabel}
                                            </span>
                                            {isRegenerated && (
                                                <Tooltip
                                                    title={
                                                        microcopy.ai
                                                            .regeneratedTooltip
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
                                                                    fontSize.xs -
                                                                    1,
                                                                marginInlineEnd: 4
                                                            }}
                                                        />
                                                        {
                                                            microcopy.ai
                                                                .regeneratedBadge
                                                        }
                                                    </Tag>
                                                </Tooltip>
                                            )}
                                        </span>
                                        <time
                                            data-testid="assistant-message-time"
                                            dateTime={new Date(
                                                messageTimeAt(index)
                                            ).toISOString()}
                                            style={{
                                                fontVariantNumeric:
                                                    "tabular-nums",
                                                marginInlineStart: "auto",
                                                whiteSpace: "nowrap"
                                            }}
                                        >
                                            {formatClock(messageTimeAt(index))}
                                        </time>
                                    </AssistantAttribution>
                                )}
                                {/* P3-D: Edit button for user messages */}
                                {isUser && !isLoading && (
                                    <Button
                                        aria-label={microcopy.a11y.editMessage}
                                        icon={<EditOutlined aria-hidden />}
                                        onClick={() => {
                                            setInput(m.content);
                                            inputRef.current?.focus({
                                                cursor: "end"
                                            });
                                        }}
                                        size="small"
                                        type="text"
                                    />
                                )}
                                <MessageBubble $isUser={isUser}>
                                    {isAssistant ? (
                                        isProseLong && !isExpanded ? (
                                            <>
                                                {renderMarkdown(
                                                    m.content
                                                        .split(/\s+/)
                                                        .slice(0, 150)
                                                        .join(" ")
                                                )}
                                                <Button
                                                    onClick={() =>
                                                        setExpandedMessages(
                                                            (prev) => {
                                                                const next =
                                                                    new Set(
                                                                        prev
                                                                    );
                                                                next.add(index);
                                                                return next;
                                                            }
                                                        )
                                                    }
                                                    size="small"
                                                    style={{
                                                        display: "block",
                                                        marginTop: space.xxs
                                                    }}
                                                    type="link"
                                                >
                                                    {
                                                        microcopy.ai
                                                            .showFullResponse
                                                    }
                                                </Button>
                                            </>
                                        ) : (
                                            renderMarkdown(m.content)
                                        )
                                    ) : (
                                        m.content
                                    )}
                                    {isAssistant &&
                                        m.citations &&
                                        m.citations.length > 0 &&
                                        (() => {
                                            const all = m.citations;
                                            const citationsExpanded =
                                                expandedCitations.has(index);
                                            const showAll =
                                                citationsExpanded ||
                                                all.length <=
                                                    CITATION_INLINE_LIMIT;
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
                                                                citation={
                                                                    citation
                                                                }
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
                                                            aria-label={microcopy.a11y.showAllSources.replace(
                                                                "{count}",
                                                                String(
                                                                    all.length
                                                                )
                                                            )}
                                                            onClick={(
                                                                event
                                                            ) => {
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
                                                            {microcopy.ai.moreSources.replace(
                                                                "{count}",
                                                                String(overflow)
                                                            )}
                                                        </Button>
                                                    )}
                                                </span>
                                            );
                                        })()}
                                </MessageBubble>
                                {isAssistant &&
                                    m.citations?.length === 0 &&
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
                                            aria-label={microcopyString(
                                                microcopy.ai.copyMessage
                                            )}
                                            icon={
                                                copyConfirmedAssistantIndex ===
                                                index ? (
                                                    <CheckOutlined
                                                        aria-hidden
                                                    />
                                                ) : (
                                                    <CopyOutlined aria-hidden />
                                                )
                                            }
                                            onClick={() => {
                                                const plainText =
                                                    m.content.replace(
                                                        /\*\*|__|~~|`{1,3}|\[|\]|\(|\)/g,
                                                        ""
                                                    );
                                                void navigator.clipboard
                                                    .writeText(plainText)
                                                    .then(() => {
                                                        if (
                                                            copyConfirmClearRef.current !==
                                                            null
                                                        ) {
                                                            window.clearTimeout(
                                                                copyConfirmClearRef.current
                                                            );
                                                        }
                                                        setCopyConfirmedAssistantIndex(
                                                            index
                                                        );
                                                        copyConfirmClearRef.current =
                                                            window.setTimeout(
                                                                () => {
                                                                    setCopyConfirmedAssistantIndex(
                                                                        null
                                                                    );
                                                                    copyConfirmClearRef.current =
                                                                        null;
                                                                },
                                                                2000
                                                            );
                                                    });
                                            }}
                                            size="small"
                                            type="text"
                                        />
                                        <Button
                                            aria-label={
                                                microcopy.a11y
                                                    .regenerateResponse
                                            }
                                            icon={
                                                <ReloadOutlined aria-hidden />
                                            }
                                            onClick={() =>
                                                handleRegenerate(index)
                                            }
                                            size="small"
                                            type="text"
                                        />
                                        <Button
                                            aria-label={
                                                microcopy.a11y.helpfulAnswer
                                            }
                                            aria-pressed={
                                                turnFeedback?.value === "up"
                                            }
                                            onClick={() =>
                                                handleThumbsUp(index)
                                            }
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
                                                        feedbackOpenFor ===
                                                        index
                                                    }
                                                    aria-haspopup="dialog"
                                                    aria-label={
                                                        microcopy.a11y
                                                            .notHelpfulGiveFeedback
                                                    }
                                                    aria-pressed={
                                                        turnFeedback?.value ===
                                                        "down"
                                                    }
                                                    onClick={() =>
                                                        handleThumbsDownClick(
                                                            index
                                                        )
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
                    {/* v2.1 inserts — MutationProposal and TriageNudge cards
                    emitted by an agent stream. Owners pass `onAcceptProposal`
                    / `onDismissNudge` to drive `agent.resume(...)`; when
                    omitted the drawer hides cards locally so the user can
                    always dismiss.
                    MutationProposalCard is gated behind
                    `environment.aiMutationProposalsEnabled` (defaults false)
                    until the backend lifecycle and fe.applyMutation are
                    ready. See REACT_APP_AI_MUTATION_PROPOSALS_ENABLED. */}
                    {environment.aiMutationProposalsEnabled &&
                        visibleProposal && (
                            <MutationProposalCard
                                onAccept={() =>
                                    handleAcceptProposal(visibleProposal)
                                }
                                onReject={() =>
                                    handleRejectProposal(visibleProposal)
                                }
                                proposal={visibleProposal}
                            />
                        )}
                    {visibleNudges.length > 0 && (
                        <>
                            {visibleNudges.map((nudge) => (
                                <NudgeCard
                                    key={nudge.nudge_id}
                                    nudge={nudge}
                                    onAction={
                                        onActionNudge
                                            ? handleNudgeAction
                                            : undefined
                                    }
                                    onDismiss={handleNudgeDismiss}
                                />
                            ))}
                        </>
                    )}
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
                                        aria-label={microcopy.a11y.tryFollowUp.replace(
                                            "{prompt}",
                                            prompt
                                        )}
                                        checked={false}
                                        key={prompt}
                                        onChange={() => dispatch(prompt)}
                                    >
                                        {prompt}
                                    </SamplePrompt>
                                ))}
                        </Space>
                    )}
                    {isLoading &&
                        (showDelayedLoadingBubble || !!streamingText) && (
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
                                        <>
                                            <Skeleton
                                                active
                                                aria-label={
                                                    microcopy.ai.streaming
                                                }
                                                paragraph={{
                                                    rows: 2,
                                                    width: ["80%", "55%"]
                                                }}
                                                title={false}
                                            />
                                            {/* P2-I: "Still thinking…" after 3 s in the pre-token phase */}
                                            {loadingMs >= 3000 && (
                                                <Text
                                                    style={{
                                                        display: "block",
                                                        fontSize: fontSize.xs,
                                                        marginTop: 4
                                                    }}
                                                    type="secondary"
                                                >
                                                    {microcopy.ai.stillThinking}
                                                </Text>
                                            )}
                                        </>
                                    )}
                                </MessageBubble>
                                <AssistantDisclaimer>
                                    {microcopy.a11y.aiBadge}
                                </AssistantDisclaimer>
                            </MessageRow>
                        )}
                </div>
                {/* P2-D: scroll-to-bottom FAB shown when user scrolls up during streaming */}
                {showScrollFab && isLoading && (
                    <Button
                        onClick={() => {
                            messagesContainerRef.current?.scrollTo({
                                top: messagesContainerRef.current.scrollHeight,
                                behavior: "smooth"
                            });
                            setShowScrollFab(false);
                        }}
                        size="small"
                        style={{
                            bottom: 72,
                            left: "50%",
                            position: "absolute",
                            transform: "translateX(-50%)",
                            zIndex: 10
                        }}
                        type="default"
                    >
                        {`\u2193 ${microcopy.ai.jumpToLatest}`}
                    </Button>
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
                    description={
                        error instanceof AgentBudgetError
                            ? microcopy.ai.conversationTooLong
                            : errorView.body || undefined
                    }
                    onClose={() => {
                        // P1-C: preserve last user message in input on budget error
                        if (error instanceof AgentBudgetError) {
                            const lastUser = [...messages]
                                .reverse()
                                .find((m) => m.role === "user");
                            if (lastUser) setInput(lastUser.content);
                        }
                        dismissError();
                    }}
                    showIcon
                    style={{ marginBottom: space.xs }}
                    title={errorView.heading}
                    type={errorView.severity}
                />
            )}

            <AiChatComposer
                healthStatus={healthStatus}
                input={input}
                inputRef={inputRef}
                isLoading={isLoading}
                onAbort={abort}
                onSend={handleSend}
                promptCharHintText={promptCharHintText}
                promptCharHintWarning={promptCharHintWarning}
                remoteHealthEnabled={remoteHealthEnabled}
                setInput={setInput}
            />
        </Drawer>
    );
};

/**
 * Public export. Wraps `AiChatDrawerInner` in a `QueryClientProvider`
 * fallback so the component does not crash when rendered in test sandboxes
 * or Storybook stories that do not provide a parent `QueryClientProvider`.
 * When a provider is already present in the tree the inner component sees
 * that context directly — the fallback client is never used.
 */
const AiChatDrawer: React.FC<AiChatDrawerProps> = (props) => {
    const existingClient = useContext(QueryClientContext);
    if (existingClient) {
        return <AiChatDrawerInner {...props} />;
    }
    return (
        <QueryClientProvider client={fallbackQueryClient}>
            <AiChatDrawerInner {...props} />
        </QueryClientProvider>
    );
};

export default AiChatDrawer;
