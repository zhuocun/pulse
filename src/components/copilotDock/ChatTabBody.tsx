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
import { AiChatComposer } from "../aiChatDrawer/AiChatComposer";
import {
    AssistantAttribution,
    AssistantDisclaimer,
    MessageBubble,
    MessageRow,
    StreamingCursor,
    ToolPayloadPanel
} from "../aiChatDrawer/aiChatDrawerStyles";
import SamplePrompt from "../aiChatDrawer/samplePrompt";
import {
    BUDGET_CRITICAL_THRESHOLD,
    BUDGET_WARN_THRESHOLD,
    CITATION_INLINE_LIMIT,
    humanizeTool,
    summarizeToolBody
} from "../aiChatDrawer/aiChatToolDisplay";
import AiSparkleIcon from "../aiSparkleIcon";
import CitationChip from "../citationChip";
import CopilotAboutPopover from "../copilotAboutPopover";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import MutationProposalCard from "../mutationProposalCard";
import NudgeCard from "../nudgeCard";

const { Text } = Typography;

interface ChatTurnFeedback {
    /** Index of the assistant message in the visible transcript. */
    index: number;
    value: "up" | "down";
}

const DUE_KEYWORDS = ["due", "deadline", "overdue", "by friday", "by monday"];

const computeFollowUpChips = (
    lastUserText: string,
    memberUsernames: readonly string[],
    chips: {
        riskFromDue: string;
        workOnPerson: string;
        defaults: readonly string[];
    }
): string[] => {
    const text = (lastUserText ?? "").toLowerCase();
    const trimmedDefaults = chips.defaults.slice(0, 3);
    const usesDueKeyword = DUE_KEYWORDS.some((kw) => text.includes(kw));
    const mentionedMember = memberUsernames.find(
        (u) => u && text.includes(u.toLowerCase())
    );
    if (mentionedMember) {
        const personChip = chips.workOnPerson.replace(
            "{name}",
            mentionedMember
        );
        return [personChip, ...trimmedDefaults.slice(0, 2)];
    }
    if (usesDueKeyword) {
        return [chips.riskFromDue, ...trimmedDefaults.slice(0, 2)];
    }
    return trimmedDefaults.slice(0, 3);
};

export interface ChatTabBodyProps {
    /**
     * Whether the host surface (legacy drawer or copilot dock) is open.
     * Drives close-side teardown (abort in-flight stream, clear composer)
     * but NOT mount/unmount — the body stays mounted across dock-internal
     * tab switches so chat history + composer state survive.
     */
    dockOpen: boolean;
    /**
     * Whether this body is the *active surface* the user is looking at.
     * Drives focus + prompt dispatch + history restore — anything that
     * should only run when the user is actually viewing the chat tab.
     * Defaults to `dockOpen` so legacy single-surface drawers (and tests
     * that haven't been migrated) keep behaving identically.
     */
    tabActive?: boolean;
    project: IProject | null;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
    knownProjectIds: string[];
    initialPrompt?: string;
    pendingProposal?: MutationProposal;
    pendingNudges?: TriageNudge[];
    onAcceptProposal?: (proposal: MutationProposal) => void;
    onRejectProposal?: (proposal: MutationProposal) => void;
    onUndoProposal?: (proposal: MutationProposal) => void;
    onActionNudge?: (nudge: TriageNudge) => void;
    onDismissNudge?: (nudge: TriageNudge) => void;
}

const fallbackQueryClient = new QueryClient();

const ChatTabBodyInner: React.FC<ChatTabBodyProps> = ({
    dockOpen,
    tabActive,
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
    onUndoProposal,
    onActionNudge,
    onDismissNudge
}) => {
    // `tabActive` defaults to `dockOpen` so call sites that don't split
    // the two (legacy drawer wrappers) keep the original single-surface
    // semantics. Inside this body:
    //   - `dockOpen`     drives close-side cleanup only.
    //   - `surfaceVisible` (dockOpen && tabActive) drives focus, prompt
    //     dispatch, and history restore — anything that should only run
    //     while the user is looking at the chat surface.
    const surfaceVisible = dockOpen && (tabActive ?? true);
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
            return {
                ...o,
                disabled: true
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
    const [expandedMessages, setExpandedMessages] = useState<Set<number>>(
        () => new Set()
    );
    const [streamingAnnouncement, setStreamingAnnouncement] = useState("");
    const [showScrollFab, setShowScrollFab] = useState(false);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const lastAssistantRef = useRef<HTMLDivElement | null>(null);
    const shouldFocusAssistantOnCompleteRef = useRef(false);
    const prevIsLoadingRef = useRef(false);
    const [budgetWarnDismissed, setBudgetWarnDismissed] = useState(false);

    const [regeneratedIndices, setRegeneratedIndices] = useState<Set<number>>(
        () => new Set()
    );
    const [expandedCitations, setExpandedCitations] = useState<Set<number>>(
        () => new Set()
    );
    const [messageTimes, setMessageTimes] = useState<number[]>([]);
    const [expandedToolIndices, setExpandedToolIndices] = useState<Set<number>>(
        () => new Set()
    );
    const [copyConfirmedAssistantIndex, setCopyConfirmedAssistantIndex] =
        useState<number | null>(null);
    const copyConfirmClearRef = useRef<number | null>(null);

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
    const pendingRegenAfter = useRef<number | null>(null);
    const inputRef = useRef<TextAreaRef | null>(null);
    const historyRestoredForRef = useRef<string | null>(null);
    const screens = Grid.useBreakpoint();
    const initialPromptHandled = useRef<string | null>(null);
    const { message } = App.useApp();

    useEffect(() => {
        if (!surfaceVisible) {
            return;
        }
        const handle = window.setTimeout(() => {
            inputRef.current?.focus({ cursor: "end" });
        }, 0);
        return () => window.clearTimeout(handle);
    }, [surfaceVisible]);

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
    // Gated on `dockOpen` (not `surfaceVisible`): a request started while
    // chat was the active tab must continue streaming after the user
    // switches to Brief — the body stays mounted, the stream is in flight,
    // tearing it down on tab switch was the original R1-H1 regression.
    const localChat = useAiChat(
        environment.aiUseLocalEngine && dockOpen ? chatCtx : null
    );
    const agentChat = useAgentChat(
        !environment.aiUseLocalEngine && dockOpen ? chatCtx : null,
        { allowedAutonomy }
    );

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

    useEffect(() => {
        if (!dockOpen || !project?._id) return;
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
    }, [dockOpen, project?._id, seedMessages]);

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
        if (!dockOpen) {
            setLocalProposalHandled(false);
            setLocallyDismissedNudges(new Set());
        }
    }, [dockOpen]);

    // Body owns the close-side cleanup that the legacy drawer previously
    // routed through its own `handleClose` (abort + input reset). Watching
    // `dockOpen` (NOT `surfaceVisible`) so a tab switch from Chat → Brief
    // does NOT abort the in-flight stream or wipe the composer — the body
    // stays mounted and its state must survive (R1-H1).
    useEffect(() => {
        if (dockOpen) return;
        abort();
        setInput("");
    }, [abort, dockOpen]);

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

    const lastUserText = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const m = messages[i];
            if (m?.role === "user" && typeof m.content === "string") {
                return m.content;
            }
        }
        return "";
    }, [messages]);
    const memberUsernames = useMemo(
        () => members.map((m) => m.username ?? "").filter((u) => u.length > 0),
        [members]
    );
    const followUpChips = useMemo(
        () =>
            computeFollowUpChips(lastUserText, memberUsernames, {
                riskFromDue: microcopy.ai.followUpChips.riskFromDue,
                workOnPerson: microcopy.ai.followUpChips.workOnPerson,
                defaults: microcopy.ai.followUpChips.defaults
            }),
        [lastUserText, memberUsernames]
    );

    useEffect(() => {
        // Dispatch only when the chat tab is actually visible — opening
        // the dock on the Brief tab via a palette prompt must NOT auto-
        // send into the chat surface.
        if (!surfaceVisible || !initialPrompt) return;
        if (initialPromptHandled.current === initialPrompt) return;
        initialPromptHandled.current = initialPrompt;
        dispatch(initialPrompt);
    }, [dispatch, initialPrompt, surfaceVisible]);

    useEffect(() => {
        if (!dockOpen) initialPromptHandled.current = null;
    }, [dockOpen]);

    const handleSend = () => {
        dispatch(input);
    };

    const handleRegenerate = (turnIndex: number) => {
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
        pendingRegenAfter.current = messages.length;
        shouldFocusAssistantOnCompleteRef.current = true;
        dispatch(previous.content);
    };

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
        if (existing?.value === "up") return;
        recordFeedback(turnIndex, "up");
        message.success(microcopy.ai.feedbackThanks);
    };

    const handleThumbsDownClick = (turnIndex: number) => {
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
        recordFeedback(turnIndex, "down");
        setFeedbackOpenFor(null);
    };

    const approxTokenCount = messages.reduce(
        (acc, m) => acc + Math.ceil(m.content.length / 4),
        0
    );

    const errorView = error ? aiErrorView(error) : null;

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

    const [completionAnnouncement, setCompletionAnnouncement] = useState("");
    const wasLoadingRef = useRef(false);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
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

    useEffect(() => {
        if (isLoading) {
            setStreamingAnnouncement(
                microcopyString(microcopy.ai.chatResponding)
            );
        } else {
            setStreamingAnnouncement("");
        }
    }, [isLoading]);

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
        <>
            <Space
                size={space.xs}
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: space.xs
                }}
            >
                <Select
                    aria-label={microcopyString(
                        microcopy.ai.autonomySelectorAriaLabel
                    )}
                    onChange={(value: AutonomyLevel) => setAutonomyLevel(value)}
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
                            title: opt.disabled ? tooltip : undefined,
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
                        !screens.md ? microcopy.ai.newConversation : undefined
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
            <CopilotRemoteConsentNotice route="chat" />
            {/* Inline health status alert */}
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
            <div
                style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}
            >
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape refocuses composer from scroll container */}
                <div
                    aria-busy={isLoading}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            inputRef.current?.focus({ cursor: "end" });
                        }
                    }}
                    onScroll={() => {
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
                        const wordCount = m.content
                            .split(/\s+/)
                            .filter(Boolean).length;
                        const isProseLong =
                            isAssistant &&
                            wordCount > 300 &&
                            !/^[#\-*]/.test(m.content.trim());
                        const isExpanded = expandedMessages.has(index);
                        const renderMarkdown = (
                            text: string
                        ): React.ReactNode => {
                            const lines = text.split("\n");
                            return lines.map((line, li) => {
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
                    {environment.aiMutationProposalsEnabled &&
                        visibleProposal && (
                            <MutationProposalCard
                                onAccept={() =>
                                    handleAcceptProposal(visibleProposal)
                                }
                                onReject={() =>
                                    handleRejectProposal(visibleProposal)
                                }
                                onUndo={
                                    onUndoProposal
                                        ? () => onUndoProposal(visibleProposal)
                                        : undefined
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
                    {!isLoading && messages.length > 0 && (
                        <Space
                            size={space.xs}
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                marginTop: space.xs
                            }}
                        >
                            {followUpChips.map((prompt) => (
                                <SamplePrompt
                                    aria-label={microcopy.a11y.tryFollowUp.replace(
                                        "{prompt}",
                                        prompt
                                    )}
                                    checked={false}
                                    data-testid="chat-follow-up-chip"
                                    key={prompt}
                                    onChange={() => {
                                        setInput(prompt);
                                        inputRef.current?.focus({
                                            cursor: "end"
                                        });
                                    }}
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
                        {`↓ ${microcopy.ai.jumpToLatest}`}
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
        </>
    );
};

/**
 * Public export. Wraps `ChatTabBodyInner` in a `QueryClientProvider`
 * fallback so the component does not crash when rendered in test sandboxes
 * or Storybook stories that do not provide a parent `QueryClientProvider`.
 * When a provider is already present in the tree the inner component sees
 * that context directly — the fallback client is never used.
 */
const ChatTabBody: React.FC<ChatTabBodyProps> = (props) => {
    const existingClient = useContext(QueryClientContext);
    if (existingClient) {
        return <ChatTabBodyInner {...props} />;
    }
    return (
        <QueryClientProvider client={fallbackQueryClient}>
            <ChatTabBodyInner {...props} />
        </QueryClientProvider>
    );
};

export default ChatTabBody;
