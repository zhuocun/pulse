import { useCallback, useRef, useState } from "react";

import type {
    CitationRef,
    AgentStreamRequest,
    AutonomyLevel,
    InterruptPayload,
    MutationProposal,
    StreamPart,
    TriageNudge
} from "../../interfaces/agent";
import {
    AgentBudgetError,
    AgentForbiddenError,
    AgentRateLimitError,
    AgentTransportError
} from "../ai/agentErrors";
import type { FeTool, FeToolContext } from "../ai/feTools";

export type AgentToolResolverStatus = "idle" | "resolving" | "error";

interface ResolveInterruptOptions {
    registry: Record<string, FeTool<unknown, unknown>>;
    autoResume: boolean;
    autonomy: AutonomyLevel;
    threadId: string;
    lastInterrupt: InterruptPayload | null;
    interrupt: InterruptPayload;
    ctx: FeToolContext;
}

interface AutoResumeLoopOptions {
    initialBody: AgentStreamRequest;
    consumeStreamRound: (
        body: AgentStreamRequest
    ) => Promise<{ pendingResume: unknown | undefined; streamFailed: boolean }>;
    onAutoResumeApplied: () => void;
    maxRounds?: number;
}

interface AutoResumeLoopResult {
    turnErrored: boolean;
    loopExhausted: boolean;
}

interface AgentSuggestionLike {
    surface: "brief" | "draft" | "estimate" | "readiness" | "search";
    payload: unknown;
}

interface AgentMessageLike {
    role: "user" | "assistant" | "tool" | "system";
    content: string;
}

interface AgentStateLike {
    messages: AgentMessageLike[];
    lastUpdate?: Record<string, unknown>;
    lastUsage?: { tokensIn: number; tokensOut: number };
}

export interface ApplyStreamPartHandlers {
    setState: (updater: (prev: AgentStateLike) => AgentStateLike) => void;
    setPendingInterrupt: (payload: InterruptPayload | null) => void;
    setPendingProposal: (proposal: MutationProposal | null) => void;
    setCitations: (refs: CitationRef[]) => void;
    setNudges: (nudge: TriageNudge) => void;
    setLastSuggestion: (suggestion: AgentSuggestionLike) => void;
    setLastUsageRef: (usage: { tokensIn: number; tokensOut: number }) => void;
    onMidStreamErrorEnvelope: (err: Error) => void;
    resolveInterrupt: (
        interrupt: InterruptPayload
    ) => Promise<unknown | undefined>;
}

export interface UseAgentToolResolverResult {
    status: AgentToolResolverStatus;
    error: Error | null;
    resolveInterrupt: (
        options: ResolveInterruptOptions
    ) => Promise<unknown | undefined>;
    runAutoResumeLoop: (
        options: AutoResumeLoopOptions
    ) => Promise<AutoResumeLoopResult>;
}

/**
 * User-facing message for the BE server-side tool-round limit cap. The
 * raw server message is verbose ("Server tool round limit reached after
 * N rounds") so we substitute a friendlier line that nudges the user to
 * narrow the question.
 */
export const TOOL_ROUND_LIMIT_USER_MESSAGE =
    "I've used too many tool calls — could you rephrase or narrow the question?";

export const isToolRoundLimitErrorCode = (code: string | undefined): boolean =>
    code === "tool_round_limit_exceeded" || code === "tool_round_limit";

const ASSISTANT_STREAM_TYPES = new Set([
    "ai",
    "assistant",
    "AIMessageChunk"
]);

export const isAssistantStreamChunk = (type?: string): boolean =>
    type === undefined || ASSISTANT_STREAM_TYPES.has(type);

export const hookErrorFromAgentStreamErrorData = (
    data: Extract<StreamPart, { type: "error" }>["data"]
): Error => {
    const message = data.message ?? "Agent stream error";
    const code =
        typeof data.code === "string" && data.code.length > 0
            ? data.code
            : undefined;

    if (code === "budget" || code === "budget_exhausted") {
        return new AgentBudgetError(message, code);
    }
    if (
        code === "forbidden" ||
        code === "autonomy_denied" ||
        code === "permission_denied"
    ) {
        return new AgentForbiddenError(message, code);
    }
    if (code === "rateLimit" || code === "rate_limit") {
        return new AgentRateLimitError(0, message);
    }
    if (isToolRoundLimitErrorCode(code)) {
        // Surface a user-friendly message rather than the raw server
        // string — the FE chat UI renders `error.message` verbatim.
        return new AgentTransportError(
            TOOL_ROUND_LIMIT_USER_MESSAGE,
            undefined,
            code
        );
    }

    return new AgentTransportError(message, undefined, code);
};

export const applyStreamPart = async (
    part: StreamPart,
    handlers: ApplyStreamPartHandlers
): Promise<unknown | undefined> => {
    switch (part.type) {
        case "updates":
            handlers.setState((prev) => ({ ...prev, lastUpdate: part.data }));
            return undefined;
        case "messages": {
            const [chunk] = part.data;
            if (!isAssistantStreamChunk(chunk?.type)) return undefined;
            const content = chunk?.content ?? "";
            if (!content) return undefined;
            handlers.setState((prev) => {
                const last = prev.messages[prev.messages.length - 1];
                if (last && last.role === "assistant") {
                    const next = [...prev.messages];
                    next[next.length - 1] = {
                        ...last,
                        content: last.content + content
                    };
                    return { ...prev, messages: next };
                }
                return {
                    ...prev,
                    messages: [...prev.messages, { role: "assistant", content }]
                };
            });
            return undefined;
        }
        case "custom": {
            const event = part.data;
            switch (event.kind) {
                case "citation":
                    handlers.setCitations(event.refs);
                    return undefined;
                case "mutation_proposal":
                    handlers.setPendingProposal(event.proposal);
                    return undefined;
                case "usage":
                    handlers.setState((prev) => ({
                        ...prev,
                        lastUsage: {
                            tokensIn: event.tokensIn,
                            tokensOut: event.tokensOut
                        }
                    }));
                    handlers.setLastUsageRef({
                        tokensIn: event.tokensIn,
                        tokensOut: event.tokensOut
                    });
                    return undefined;
                case "suggestion":
                    if (event.surface === "nudge") {
                        handlers.setNudges(event.payload);
                    } else {
                        handlers.setLastSuggestion({
                            surface: event.surface,
                            payload: event.payload
                        });
                    }
                    return undefined;
                default:
                    return undefined;
            }
        }
        case "interrupt": {
            handlers.setPendingInterrupt(part.data);
            return handlers.resolveInterrupt(part.data);
        }
        case "error": {
            handlers.onMidStreamErrorEnvelope(
                hookErrorFromAgentStreamErrorData(part.data)
            );
            return undefined;
        }
        default:
            return undefined;
    }
};

const useAgentToolResolver = (): UseAgentToolResolverResult => {
    const [status, setStatus] = useState<AgentToolResolverStatus>("idle");
    const [error, setError] = useState<Error | null>(null);
    const lastResolutionContextRef = useRef<{
        autonomy: AutonomyLevel;
        threadId: string;
        lastInterrupt: InterruptPayload | null;
    } | null>(null);

    const resolveInterrupt = useCallback(
        async ({
            registry,
            autoResume,
            autonomy,
            threadId,
            lastInterrupt,
            interrupt,
            ctx
        }: ResolveInterruptOptions): Promise<unknown | undefined> => {
            lastResolutionContextRef.current = {
                autonomy,
                threadId,
                lastInterrupt
            };

            // HITL pause: never auto-resume a mutation-approval request. The
            // user must explicitly accept or reject in the proposal card.
            if (interrupt.tool === "fe.requestMutationApproval") {
                return undefined;
            }

            const tool = registry[interrupt.tool];
            if (!autoResume || !tool) {
                return undefined;
            }

            setStatus("resolving");
            setError(null);
            try {
                const result = await tool.run(interrupt.args as never, ctx);
                setStatus("idle");
                return result ?? null;
            } catch (err) {
                const resolverError =
                    err instanceof Error ? err : new Error(String(err));
                setError(resolverError);
                setStatus("error");
                return { error: resolverError.message };
            }
        },
        []
    );

    const runAutoResumeLoop = useCallback(
        async ({
            initialBody,
            consumeStreamRound,
            onAutoResumeApplied,
            maxRounds = 8
        }: AutoResumeLoopOptions): Promise<AutoResumeLoopResult> => {
            let nextBody = initialBody;
            let turnErrored = false;
            let loopExhausted = false;

            for (let round = 0; round < maxRounds; round += 1) {
                const { pendingResume, streamFailed } =
                    await consumeStreamRound(nextBody);
                if (streamFailed) {
                    turnErrored = true;
                    break;
                }
                if (pendingResume === undefined) break;

                nextBody = {
                    input: null,
                    command: { resume: pendingResume },
                    config: nextBody.config,
                    stream_mode: nextBody.stream_mode,
                    version: nextBody.version
                };
                onAutoResumeApplied();

                if (round === maxRounds - 1) {
                    loopExhausted = true;
                }
            }

            return { turnErrored, loopExhausted };
        },
        []
    );

    return {
        status,
        error,
        resolveInterrupt,
        runAutoResumeLoop
    };
};

export default useAgentToolResolver;
