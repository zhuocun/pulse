import { useCallback, useEffect, useRef, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import type {
    AutonomyLevel,
    CitationRef,
    MutationProposal,
    TriageNudge
} from "../../interfaces/agent";
import type { AiChatMessage } from "../ai/chatEngine";
import type { UseAiChatContext } from "./useAiChat";
import useAgent from "./useAgent";
import type { AgentMessage } from "./useAgent";

/**
 * Map an agent role to an AiChatMessage role. AgentMessage uses "system" for
 * internal error messages but AiChatMessage only has "user" | "assistant" |
 * "tool". We map "system" → "assistant" so it's at least visible in the
 * transcript rather than silently dropped (lossy mapping).
 */
const agentRoleToChatRole = (
    role: AgentMessage["role"]
): AiChatMessage["role"] => {
    if (role === "system") return "assistant";
    return role as AiChatMessage["role"];
};

/**
 * Tool verb map — mirrors the drawer's `TOOL_VERB` so the adapter produces
 * identical tool-trace summaries for the v2.1 path as the v1 path does.
 */
const TOOL_VERB: Record<string, string> = {
    listProjects: microcopy.ai.toolVerbs.checkedProjects,
    "fe.listProjects": microcopy.ai.toolVerbs.checkedProjects,
    listMembers: microcopy.ai.toolVerbs.checkedTeamMembers,
    "fe.listMembers": microcopy.ai.toolVerbs.checkedTeamMembers,
    listBoard: microcopy.ai.toolVerbs.checkedBoardColumns,
    "fe.listBoard": microcopy.ai.toolVerbs.checkedBoardColumns,
    listTasks: microcopy.ai.toolVerbs.checkedTasks,
    "fe.listTasks": microcopy.ai.toolVerbs.checkedTasks,
    getProject: microcopy.ai.toolVerbs.openedProject,
    "fe.getProject": microcopy.ai.toolVerbs.openedProject,
    getTask: microcopy.ai.toolVerbs.openedTask,
    "fe.getTask": microcopy.ai.toolVerbs.openedTask
};

const humanizeToolName = (name: string): string => {
    if (TOOL_VERB[name]) return TOOL_VERB[name];
    // Strip "fe." prefix if present, then sentence-case
    const base = name.replace(/^fe\./, "");
    return base
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (s) => s.toUpperCase());
};

/**
 * Derive `streamingText` and a finalized `messages` list from the agent's
 * raw state. While streaming, the last assistant message is extracted as
 * `streamingText` and removed from `messages` so the drawer renders it in
 * the live streaming bubble (same pattern as `useAiChat`).
 */
const deriveMessagesAndStreaming = (
    agentMessages: AgentMessage[],
    toolTraceMessages: AiChatMessage[],
    isStreaming: boolean,
    agentCitations: CitationRef[]
): { messages: AiChatMessage[]; streamingText: string } => {
    // Merge tool-trace messages (synthesized from interrupt events) with the
    // agent's messages array, preserving chronological order. Tool traces are
    // prepended before the assistant messages that follow them.
    const mapped: AiChatMessage[] = agentMessages.map((m) => {
        const msg: AiChatMessage = {
            role: agentRoleToChatRole(m.role),
            content: m.content
        };
        if (m.toolCallId) msg.toolCallId = m.toolCallId;
        return msg;
    });

    // Insert tool-trace messages before the first assistant message that was
    // added after the trace was captured. Simple approach: append tool traces
    // as a block before any assistant messages in the list that don't already
    // have a tool trace ahead of them. We keep it simple: prepend all tool
    // traces in their captured order just before the first assistant message
    // that arrives after the first user message (index > 0). If there are no
    // assistant messages yet (still streaming), append the traces at the end.
    const result: AiChatMessage[] = [];
    let toolTracesInserted = false;
    for (const m of mapped) {
        if (
            !toolTracesInserted &&
            m.role === "assistant" &&
            toolTraceMessages.length > 0
        ) {
            result.push(...toolTraceMessages);
            toolTracesInserted = true;
        }
        result.push(m);
    }
    if (!toolTracesInserted && toolTraceMessages.length > 0) {
        result.push(...toolTraceMessages);
    }

    // While streaming, pull the last assistant message out as streamingText.
    if (isStreaming) {
        const lastIdx = result.length - 1;
        if (lastIdx >= 0 && result[lastIdx].role === "assistant") {
            const streamingText = result[lastIdx].content;
            const messages = result.slice(0, lastIdx);
            return { messages, streamingText };
        }
        // Still waiting for first token — streaming bubble shows skeleton.
        return { messages: result, streamingText: "" };
    }

    // Not streaming: attach agent citations to the last assistant message.
    if (agentCitations.length > 0) {
        const lastAssistantIdx = [...result]
            .reverse()
            .findIndex((m) => m.role === "assistant");
        if (lastAssistantIdx >= 0) {
            const absIdx = result.length - 1 - lastAssistantIdx;
            const updated = [...result];
            updated[absIdx] = {
                ...updated[absIdx],
                citations: agentCitations
            };
            return { messages: updated, streamingText: "" };
        }
    }

    return { messages: result, streamingText: "" };
};

export interface UseAgentChatResult {
    // Same shape as useAiChat:
    abort: () => void;
    dismissError: () => void;
    error: Error | null;
    isLoading: boolean;
    messages: AiChatMessage[];
    reset: () => void;
    seedMessages: (initial: AiChatMessage[]) => void;
    send: (text: string) => Promise<void>;
    streamingText: string;
    // v2.1 additions:
    pendingProposal: MutationProposal | null;
    pendingNudges: TriageNudge[];
    citations: CitationRef[];
    resumeProposal: (accepted: boolean) => void;
    dismissNudge: (nudgeId: string) => void;
}

/**
 * Adapter hook that wraps `useAgent("chat-agent")` and exposes a shape
 * compatible with `useAiChat` so the drawer's render code is largely
 * unchanged. Adds v2.1-only fields (`pendingProposal`, `pendingNudges`,
 * `citations`, `resumeProposal`, `dismissNudge`).
 *
 * Pass `ctx = null` to disable the hook (same contract as `useAiChat`).
 */
export interface UseAgentChatOptions {
    allowedAutonomy?: readonly AutonomyLevel[] | null;
}

const useAgentChat = (
    ctx: UseAiChatContext | null,
    options: UseAgentChatOptions = {}
): UseAgentChatResult => {
    // Note: useAgent already calls useQueryClient() internally and provides
    // it in the baseCtx for FE tools. We only need to pass projectId in
    // feToolContext to scope tool queries to the current project.
    const agent = useAgent("chat-agent", {
        projectId: ctx?.execution.projectId,
        feToolContext: {
            projectId: ctx?.execution.projectId
        },
        allowedAutonomy: options.allowedAutonomy
    });

    // Error dismissal: track whether the current error has been dismissed.
    const [errorDismissed, setErrorDismissed] = useState(false);
    /** Resume rejections that useAgent does not surface on `agent.error`. */
    const [resumeError, setResumeError] = useState<Error | null>(null);

    // Tool-trace messages synthesized from interrupt events. Cleared on reset.
    const [toolTraceMessages, setToolTraceMessages] = useState<AiChatMessage[]>(
        []
    );
    /** Deduplicates tool traces by tool + args, so changed FE args get distinct bubbles. */
    const lastInterruptSignatureRef = useRef<string | null>(null);
    /**
     * After `resumeProposal`, clear the card only once the underlying run
     * finishes without error; see effect below.
     */
    const proposalClearAfterResumeRef = useRef<{ proposal_id: string } | null>(
        null
    );
    const pendingProposalIdRef = useRef<string | undefined>(undefined);

    // Locally dismissed nudges (nudgeId → true).
    const [dismissedNudgeIds, setDismissedNudgeIds] = useState<Set<string>>(
        () => new Set()
    );

    // Fresh id for resumeProposal closure (avoid deps on transient proposal objects).
    pendingProposalIdRef.current = agent.pendingProposal?.proposal_id;

    // Synthesize a tool-trace bubble for each distinct (tool + args)
    // interrupt within a turn. useAgent clears the interrupt after FE-tool
    // execution; we observe each payload before it's cleared.
    const { pendingInterrupt } = agent;
    useEffect(() => {
        if (!pendingInterrupt) return;
        const interruptKey = `${pendingInterrupt.tool}:${JSON.stringify(
            pendingInterrupt.args
        )}`;
        if (lastInterruptSignatureRef.current === interruptKey) return;
        lastInterruptSignatureRef.current = interruptKey;
        const traceMsg: AiChatMessage = {
            role: "tool",
            content: `${humanizeToolName(pendingInterrupt.tool)}…`,
            toolCallId: `trace-${pendingInterrupt.tool}-${Date.now()}`,
            toolName: undefined
        };
        setToolTraceMessages((prev) => [...prev, traceMsg]);
    }, [pendingInterrupt]);

    /** When a proposal resume settles the stream successfully, dismiss the proposal card. */
    useEffect(() => {
        const draft = proposalClearAfterResumeRef.current;
        if (!draft) return;
        if (agent.isStreaming) return;
        if (agent.error ?? resumeError) {
            proposalClearAfterResumeRef.current = null;
            return;
        }
        if (agent.pendingProposal?.proposal_id !== draft.proposal_id) {
            proposalClearAfterResumeRef.current = null;
            return;
        }
        proposalClearAfterResumeRef.current = null;
        agent.clearPendingProposal();
    }, [
        agent.clearPendingProposal,
        agent.error,
        agent.isStreaming,
        agent.pendingProposal?.proposal_id,
        resumeError
    ]);

    // Derive displayed messages and streamingText from agent state.
    const { messages, streamingText } = deriveMessagesAndStreaming(
        agent.state.messages,
        toolTraceMessages,
        agent.isStreaming,
        agent.citations
    );

    // Effective error (null if dismissed).
    const activeError = agent.error ?? resumeError;
    const effectiveError = activeError && !errorDismissed ? activeError : null;

    const dismissError = useCallback(() => {
        setErrorDismissed(true);
    }, []);

    // Reset the dismissed flag when a new error comes in.
    useEffect(() => {
        if (agent.error) {
            setErrorDismissed(false);
        }
    }, [agent.error]);

    const send = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || !ctx) return;
            // Clear tool traces for the new turn.
            setToolTraceMessages([]);
            lastInterruptSignatureRef.current = null;
            setResumeError(null);
            try {
                await agent.start({
                    messages: [{ role: "user", content: trimmed }]
                });
            } catch (err) {
                // AgentForbiddenError and others are surfaced via agent.error.
                // We swallow here so callers don't need to catch.
                void err;
            }
        },
        [agent.start, ctx]
    );

    const reset = useCallback(() => {
        proposalClearAfterResumeRef.current = null;
        agent.reset();
        setToolTraceMessages([]);
        lastInterruptSignatureRef.current = null;
        setDismissedNudgeIds(new Set());
        setErrorDismissed(false);
        setResumeError(null);
    }, [agent.reset]);

    const resumeProposal = useCallback(
        (accepted: boolean) => {
            const pid = pendingProposalIdRef.current;
            if (!pid) return;
            proposalClearAfterResumeRef.current = { proposal_id: pid };
            setResumeError(null);
            void agent.resume({ accepted }).catch((err: unknown) => {
                setErrorDismissed(false);
                setResumeError(
                    err instanceof Error ? err : new Error(String(err))
                );
            });
        },
        [agent.resume]
    );

    const dismissNudge = useCallback(
        (nudgeId: string) => {
            // Propagate to the underlying useAgent inbox so the entry is
            // removed from nudgeEntries — prevents the nudge from
            // resurrecting after reset() or a new turn.
            agent.dismissNudge(nudgeId);
            // Also update the local filter set to dedupe within a single
            // render cycle (the inbox update is async-batched).
            setDismissedNudgeIds((prev) => {
                if (prev.has(nudgeId)) return prev;
                const next = new Set(prev);
                next.add(nudgeId);
                return next;
            });
        },
        [agent.dismissNudge]
    );

    const pendingNudges = agent.nudges.filter(
        (n) => !dismissedNudgeIds.has(n.nudge_id)
    );

    const seedMessages = useCallback(
        (initial: AiChatMessage[]) => {
            // Map AiChatMessage roles to AgentMessage roles for the underlying store.
            agent.seedMessages(
                initial.map((m) => ({
                    role:
                        m.role === "tool"
                            ? ("tool" as const)
                            : m.role === "user"
                              ? ("user" as const)
                              : ("assistant" as const),
                    content: m.content
                }))
            );
        },
        [agent.seedMessages]
    );

    return {
        // useAiChat-compatible fields:
        abort: agent.abort,
        dismissError,
        error: effectiveError,
        isLoading: agent.isStreaming,
        messages,
        reset,
        seedMessages,
        send,
        streamingText,
        // v2.1 additions:
        pendingProposal: agent.pendingProposal,
        pendingNudges,
        citations: agent.citations,
        resumeProposal,
        dismissNudge
    };
};

export default useAgentChat;
