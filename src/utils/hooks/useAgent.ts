import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import type {
    AutonomyLevel,
    CitationRef,
    InterruptPayload,
    MutationProposal,
    StreamPart,
    TriageNudge
} from "../../interfaces/agent";
import { STREAM_WATCHDOG_MS } from "../../theme/aiTokens";
import { AgentForbiddenError, streamAgent } from "../ai/agentClient";
import { FE_TOOL_REGISTRY } from "../ai/feTools";
import {
    isProjectAiDisabled,
    PROJECT_AI_DISABLED_MESSAGE
} from "../ai/projectAiStorage";
import type { FeToolContext } from "../ai/feTools";

export interface AgentMessage {
    role: "user" | "assistant" | "tool" | "system";
    content: string;
    toolCallId?: string;
}

export interface UseAgentState {
    messages: AgentMessage[];
    lastUpdate?: Record<string, unknown>;
    lastUsage?: { tokensIn: number; tokensOut: number };
}

interface StartOptions {
    threadId?: string;
    autonomy?: AutonomyLevel;
    /** Disable automatic FE-tool resume (caller will resolve manually). */
    autoResume?: boolean;
}

export interface UseAgentResult {
    start: (input: unknown, options?: StartOptions) => Promise<void>;
    resume: (resumeValue: unknown) => Promise<void>;
    abort: () => void;
    isStreaming: boolean;
    state: UseAgentState;
    pendingInterrupt: InterruptPayload | null;
    pendingProposal: MutationProposal | null;
    citations: CitationRef[];
    nudges: TriageNudge[];
    error: Error | null;
    reset: () => void;
    /**
     * Stable thread id for the current run (PRD v3 UA-R4). Surfaces use
     * this for share/export links; resets on `reset()`.
     */
    threadId: string;
    /**
     * Time-To-First-Token in ms for the most recent turn (PRD v3 UA-R2).
     * Null until the first `messages` chunk arrives. Surfaces compare
     * against `TTFT_TARGET_MS` to detect slow turns; analytics fires
     * `AGENT_TTFT` automatically when the value lands.
     */
    ttftMs: number | null;
    /**
     * Clears `pendingProposal` without leaving the agent run going (used
     * after a user accepts/rejects from a UI surface and the parent has
     * already wired the resume call). PRD v3 UA-R3.
     */
    clearPendingProposal: () => void;
}

export interface UseAgentOptions {
    baseUrl?: string;
    projectId?: string;
    userId?: string;
    /** Override the FE-tool ctx (lets callers add focus/selection state). */
    feToolContext?: Partial<FeToolContext>;
    /** Override threadId persistence (useful for tests). */
    initialThreadId?: string;
}

/**
 * Per-turn thread id. Uses `crypto.randomUUID()` when available (modern
 * browsers, Node 19+) and falls back to a `Math.random()` blend for SSR
 * shells / older runtimes that strip `crypto`. Exported so tests can
 * stub it without monkey-patching the global.
 */
export const generateThreadId = (): string => {
    const cryptoLike =
        typeof globalThis !== "undefined"
            ? (
                  globalThis as {
                      crypto?: { randomUUID?: () => string };
                  }
              ).crypto
            : undefined;
    if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
        return `t_${cryptoLike.randomUUID()}`;
    }
    return `t_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
};

interface ApplyStreamPartHandlers {
    setState: (updater: (prev: UseAgentState) => UseAgentState) => void;
    setPendingInterrupt: (payload: InterruptPayload | null) => void;
    setPendingProposal: (proposal: MutationProposal | null) => void;
    setCitations: (refs: CitationRef[]) => void;
    setNudges: (nudge: TriageNudge) => void;
    autoResume: boolean;
    ctx: FeToolContext;
}

/**
 * Reduce a single StreamPart into hook state. Returns a value when the part
 * is an `interrupt` for a known FE tool — the caller uses that to POST a
 * resume body and continue the run without bouncing through the UI.
 */
const applyStreamPart = async (
    part: StreamPart,
    handlers: ApplyStreamPartHandlers
): Promise<unknown | undefined> => {
    switch (part.type) {
        case "updates":
            handlers.setState((prev) => ({ ...prev, lastUpdate: part.data }));
            return undefined;
        case "messages": {
            const [chunk] = part.data;
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
                    return undefined;
                case "nudge":
                    handlers.setNudges(event.nudge);
                    return undefined;
                case "suggestion":
                default:
                    return undefined;
            }
        }
        case "interrupt": {
            handlers.setPendingInterrupt(part.data);
            const tool = FE_TOOL_REGISTRY[part.data.tool];
            if (handlers.autoResume && tool) {
                try {
                    const result = await tool.run(
                        part.data.args as never,
                        handlers.ctx
                    );
                    return result ?? null;
                } catch (err) {
                    return {
                        error: err instanceof Error ? err.message : String(err)
                    };
                }
            }
            return undefined;
        }
        case "error": {
            const message = part.data.message ?? "Agent stream error";
            handlers.setState((prev) => ({
                ...prev,
                messages: [
                    ...prev.messages,
                    { role: "system", content: message }
                ]
            }));
            return undefined;
        }
        default:
            return undefined;
    }
};

/**
 * Drive a LangGraph v2 agent run end-to-end (PRD §5). Handles SSE parsing,
 * thread-id persistence per (agent, project), interrupt → FE-tool
 * auto-resume, and surfacing citations / proposals / nudges to the UI.
 *
 * The hook is stateless about whether the agent server is reachable: a
 * `pendingProposal` only appears after the server emits a
 * `mutation_proposal` custom event; callers gate their accept/reject UI
 * on that signal.
 */
const useAgent = (
    name: string,
    options: UseAgentOptions = {}
): UseAgentResult => {
    const queryClient = useQueryClient();
    const baseUrl = options.baseUrl ?? environment.aiBaseUrl;
    const [state, setState] = useState<UseAgentState>({ messages: [] });
    const [error, setError] = useState<Error | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [pendingInterrupt, setPendingInterrupt] =
        useState<InterruptPayload | null>(null);
    const [pendingProposal, setPendingProposal] =
        useState<MutationProposal | null>(null);
    const [citations, setCitations] = useState<CitationRef[]>([]);
    const [nudges, setNudges] = useState<TriageNudge[]>([]);
    const [threadId, setThreadId] = useState<string>(
        options.initialThreadId ?? generateThreadId()
    );
    const [ttftMs, setTtftMs] = useState<number | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const threadIdRef = useRef<string>(threadId);
    const lastInputRef = useRef<unknown>(null);
    const autonomyRef = useRef<AutonomyLevel>("plan");
    const autoResumeRef = useRef<boolean>(true);
    const mountedRef = useRef(true);
    /**
     * TTFT bookkeeping. `streamStartRef` records the `performance.now()`
     * that consumeStream began; `ttftSeenRef` flips after the first
     * `messages` chunk so we only emit once per turn (UA-R2).
     */
    const streamStartRef = useRef<number | null>(null);
    const ttftSeenRef = useRef(false);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastChunkAtRef = useRef<number | null>(null);

    const clearWatchdog = useCallback(() => {
        if (watchdogRef.current !== null) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    }, []);

    useEffect(() => {
        // Re-arm on every mount so React.StrictMode's mount→unmount→remount
        // dev cycle doesn't leave `mountedRef` stuck at `false`. Otherwise
        // every async setState below the unmount would be silently dropped.
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
            clearWatchdog();
        };
    }, [clearWatchdog]);

    const safeSetState = useCallback(
        (updater: (prev: UseAgentState) => UseAgentState) => {
            if (!mountedRef.current) return;
            setState(updater);
        },
        []
    );

    const consumeStream = useCallback(
        async (
            body: Parameters<typeof streamAgent>[0]["body"],
            signal: AbortSignal,
            ctx: FeToolContext,
            controller: AbortController
        ): Promise<{ pendingResume: unknown | undefined }> => {
            let pendingResume: unknown | undefined;
            // Watchdog: if no stream chunk arrives for STREAM_WATCHDOG_MS,
            // abort the run and surface a "took too long" error (UA-R1).
            const armWatchdog = () => {
                clearWatchdog();
                lastChunkAtRef.current = performance.now();
                watchdogRef.current = setTimeout(() => {
                    controller.abort();
                    if (mountedRef.current) {
                        setError(new Error(microcopy.ai.watchdogTimeout));
                    }
                }, STREAM_WATCHDOG_MS);
            };
            armWatchdog();
            try {
                for await (const part of streamAgent({
                    name,
                    body,
                    signal,
                    baseUrl
                })) {
                    if (signal.aborted) break;
                    armWatchdog();
                    // TTFT (UA-R2): record on first `messages` chunk only.
                    if (
                        !ttftSeenRef.current &&
                        part.type === "messages" &&
                        streamStartRef.current !== null
                    ) {
                        ttftSeenRef.current = true;
                        const elapsed = Math.max(
                            0,
                            Math.round(
                                performance.now() - streamStartRef.current
                            )
                        );
                        if (mountedRef.current) setTtftMs(elapsed);
                        track(ANALYTICS_EVENTS.AGENT_TTFT, {
                            agent: name,
                            elapsedMs: elapsed
                        });
                    }
                    pendingResume = await applyStreamPart(part, {
                        setState: safeSetState,
                        setPendingInterrupt: (p) =>
                            mountedRef.current && setPendingInterrupt(p),
                        setPendingProposal: (p) =>
                            mountedRef.current && setPendingProposal(p),
                        setCitations: (refs) =>
                            mountedRef.current &&
                            setCitations((prev) => [...prev, ...refs]),
                        setNudges: (n) =>
                            mountedRef.current &&
                            setNudges((prev) => [...prev, n]),
                        autoResume: autoResumeRef.current,
                        ctx
                    });
                    if (pendingResume !== undefined) break;
                }
            } catch (err) {
                if (err instanceof Error && err.name !== "AbortError") {
                    if (mountedRef.current) setError(err);
                    throw err;
                }
            } finally {
                clearWatchdog();
            }
            return { pendingResume };
        },
        [baseUrl, clearWatchdog, name, safeSetState]
    );

    const runStream = useCallback(
        async (body: Parameters<typeof streamAgent>[0]["body"]) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            setError(null);
            setIsStreaming(true);
            // Reset TTFT bookkeeping for the new turn (UA-R2).
            streamStartRef.current = performance.now();
            ttftSeenRef.current = false;
            if (mountedRef.current) setTtftMs(null);

            const baseCtx: FeToolContext = {
                queryClient,
                projectId: options.projectId,
                userId: options.userId,
                autonomyLevel: autonomyRef.current,
                ...(options.feToolContext ?? {})
            };

            try {
                let nextBody = body;
                // Auto-resume loop: if the agent interrupts with a known FE
                // tool, run the tool synchronously and POST a `resume` body.
                for (let round = 0; round < 8; round += 1) {
                    if (controller.signal.aborted) break;
                    const { pendingResume } = await consumeStream(
                        nextBody,
                        controller.signal,
                        baseCtx,
                        controller
                    );
                    if (pendingResume === undefined) break;
                    nextBody = {
                        input: null,
                        command: { resume: pendingResume },
                        config: nextBody.config,
                        stream_mode: nextBody.stream_mode,
                        version: nextBody.version
                    };
                    // Clear interrupt state on successful auto-resume.
                    if (mountedRef.current) setPendingInterrupt(null);
                }
            } catch (err) {
                // already surfaced
                void err;
            } finally {
                clearWatchdog();
                if (
                    mountedRef.current &&
                    controllerRef.current === controller
                ) {
                    setIsStreaming(false);
                    controllerRef.current = null;
                }
            }
        },
        [
            clearWatchdog,
            consumeStream,
            options.feToolContext,
            options.projectId,
            options.userId,
            queryClient
        ]
    );

    const start = useCallback(
        async (input: unknown, startOptions: StartOptions = {}) => {
            if (startOptions.threadId) {
                threadIdRef.current = startOptions.threadId;
                if (mountedRef.current) setThreadId(startOptions.threadId);
            }
            if (startOptions.autonomy)
                autonomyRef.current = startOptions.autonomy;
            if (startOptions.autoResume === false)
                autoResumeRef.current = false;
            else autoResumeRef.current = true;

            // Guard: refuse to start if the project has AI disabled via the
            // per-project toggle (mirrors `assertRunPayloadProjectsAiAllowed`
            // in `useAi.ts`). Throws synchronously so no fetch is initiated.
            if (isProjectAiDisabled(options.projectId)) {
                throw new AgentForbiddenError(PROJECT_AI_DISABLED_MESSAGE);
            }

            lastInputRef.current = input;
            setPendingInterrupt(null);
            setPendingProposal(null);
            // Per-turn reset (review follow-up #10): citations and nudges
            // are scoped to a single user turn, so each new `start()` call
            // discards the previous turn's surfaces. Multi-turn within one
            // `start()` (auto-resume loop) continues to accumulate inside
            // `consumeStream` so the agent can stream multiple citations
            // for a single answer.
            setCitations([]);
            setNudges([]);
            const messages =
                typeof input === "string"
                    ? [{ role: "user" as const, content: input }]
                    : ((input as { messages?: AgentMessage[] }).messages ?? []);

            // Reflect the user message immediately so chat UIs feel instant.
            safeSetState((prev) => ({
                ...prev,
                messages: [...prev.messages, ...messages]
            }));

            // NOTE: `user_id` is intentionally NOT placed on the wire here.
            // The agent server derives identity from the JWT in
            // `Authorization` and rejects any client-supplied `user_id` in
            // `configurable` with HTTP 400 to prevent identity spoofing
            // (see jira-python-server `app/routers/agents.py::_normalize_payload`).
            // `options.userId` is still consumed above for FE-internal
            // bookkeeping (e.g. `feToolContext.userId`).
            await runStream({
                input: { messages },
                config: {
                    configurable: {
                        thread_id: threadIdRef.current,
                        project_id: options.projectId ?? "",
                        autonomy: autonomyRef.current
                    }
                },
                stream_mode: ["updates", "messages", "custom"],
                version: "v2"
            });
        },
        [options.projectId, runStream, safeSetState]
    );

    const resume = useCallback(
        async (resumeValue: unknown) => {
            // See `start()` above for why `user_id` is omitted from the
            // wire body — the server derives it from the JWT.
            await runStream({
                input: null,
                command: { resume: resumeValue },
                config: {
                    configurable: {
                        thread_id: threadIdRef.current,
                        project_id: options.projectId ?? "",
                        autonomy: autonomyRef.current
                    }
                },
                stream_mode: ["updates", "messages", "custom"],
                version: "v2"
            });
        },
        [options.projectId, runStream]
    );

    const abort = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        if (mountedRef.current) setIsStreaming(false);
    }, []);

    const reset = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        clearWatchdog();
        if (!mountedRef.current) return;
        setState({ messages: [] });
        setPendingInterrupt(null);
        setPendingProposal(null);
        setCitations([]);
        setNudges([]);
        setError(null);
        setIsStreaming(false);
        setTtftMs(null);
        const next = generateThreadId();
        threadIdRef.current = next;
        setThreadId(next);
        ttftSeenRef.current = false;
        streamStartRef.current = null;
    }, [clearWatchdog]);

    const clearPendingProposal = useCallback(() => {
        if (mountedRef.current) setPendingProposal(null);
    }, []);

    return useMemo(
        () => ({
            start,
            resume,
            abort,
            isStreaming,
            state,
            pendingInterrupt,
            pendingProposal,
            citations,
            nudges,
            error,
            reset,
            threadId,
            ttftMs,
            clearPendingProposal
        }),
        [
            abort,
            citations,
            clearPendingProposal,
            error,
            isStreaming,
            nudges,
            pendingInterrupt,
            pendingProposal,
            reset,
            resume,
            start,
            state,
            threadId,
            ttftMs
        ]
    );
};

export default useAgent;
