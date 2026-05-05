import { useCallback, useEffect, useRef, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import type {
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
const useAgentChat = (ctx: UseAiChatContext | null): UseAgentChatResult => {
    // Note: useAgent already calls useQueryClient() internally and provides
    // it in the baseCtx for FE tools. We only need to pass projectId in
    // feToolContext to scope tool queries to the current project.
    const agent = useAgent("chat-agent", {
        projectId: ctx?.execution.projectId,
        feToolContext: {
            projectId: ctx?.execution.projectId
        }
    });

    // Error dismissal: track whether the current error has been dismissed.
    const [errorDismissed, setErrorDismissed] = useState(false);

    // Tool-trace messages synthesized from interrupt events. Cleared on reset.
    const [toolTraceMessages, setToolTraceMessages] = useState<AiChatMessage[]>(
        []
    );
    // Track which interrupt we've already synthesized a trace for.
    const lastInterruptToolRef = useRef<string | null>(null);

    // Locally dismissed nudges (nudgeId → true).
    const [dismissedNudgeIds, setDismissedNudgeIds] = useState<Set<string>>(
        () => new Set()
    );

    // Synthesize a tool-trace bubble whenever pendingInterrupt changes to a
    // new tool name. The auto-resume loop in useAgent clears the interrupt
    // after execution, but we capture it here before it's cleared.
    const { pendingInterrupt } = agent;
    useEffect(() => {
        if (!pendingInterrupt) return;
        if (lastInterruptToolRef.current === pendingInterrupt.tool) return;
        lastInterruptToolRef.current = pendingInterrupt.tool;
        const traceMsg: AiChatMessage = {
            role: "tool",
            content: `${humanizeToolName(pendingInterrupt.tool)}…`,
            toolCallId: `trace-${pendingInterrupt.tool}-${Date.now()}`,
            toolName: undefined
        };
        setToolTraceMessages((prev) => [...prev, traceMsg]);
    }, [pendingInterrupt]);

    // Derive displayed messages and streamingText from agent state.
    const { messages, streamingText } = deriveMessagesAndStreaming(
        agent.state.messages,
        toolTraceMessages,
        agent.isStreaming,
        agent.citations
    );

    // Effective error (null if dismissed).
    const effectiveError = agent.error && !errorDismissed ? agent.error : null;

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
            lastInterruptToolRef.current = null;
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
        [agent, ctx]
    );

    const reset = useCallback(() => {
        agent.reset();
        setToolTraceMessages([]);
        lastInterruptToolRef.current = null;
        setDismissedNudgeIds(new Set());
        setErrorDismissed(false);
    }, [agent]);

    const resumeProposal = useCallback(
        (accepted: boolean) => {
            agent.clearPendingProposal();
            void agent.resume({ accepted });
        },
        [agent]
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
        [agent]
    );

    const pendingNudges = agent.nudges.filter(
        (n) => !dismissedNudgeIds.has(n.nudge_id)
    );

    return {
        // useAiChat-compatible fields:
        abort: agent.abort,
        dismissError,
        error: effectiveError,
        isLoading: agent.isStreaming,
        messages,
        reset,
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
