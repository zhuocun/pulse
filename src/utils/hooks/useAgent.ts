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
import {
    AgentBudgetError,
    AgentForbiddenError,
    AgentRateLimitError,
    AgentTransportError
} from "../ai/agentErrors";
import { streamAgent } from "../ai/agentClient";
import { FE_TOOL_REGISTRY } from "../ai/feTools";
import {
    isProjectAiDisabled,
    PROJECT_AI_DISABLED_MESSAGE
} from "../ai/projectAiStorage";
import type { FeToolContext } from "../ai/feTools";
import { useAutonomyLevel } from "./useAiEnabled";

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

/**
 * A suggestion emitted by server-side agents (board-brief-agent,
 * task-drafting-agent, task-estimation-agent, search-agent) via
 * the `custom/suggestion` stream event.
 */
export interface AgentSuggestion {
    surface: "brief" | "draft" | "estimate" | "readiness" | "search";
    payload: unknown;
}

interface StartOptions {
    threadId?: string;
    autonomy?: AutonomyLevel;
    /** Disable automatic FE-tool resume (caller will resolve manually). */
    autoResume?: boolean;
}

/**
 * Normalised lifecycle status for the hook (Theme 2). Derived from existing
 * state — no new state machine introduced.
 *
 *   idle        — never started, or after reset().
 *   connecting  — POST in flight, no message chunks received yet.
 *   streaming   — chunks are flowing.
 *   interrupted — pendingInterrupt !== null (waiting for human or FE tool).
 *   terminal    — last run ended in completed / error / cancelled.
 */
export type AgentStatus =
    | "idle"
    | "connecting"
    | "streaming"
    | "interrupted"
    | "terminal";

export interface UseAgentResult {
    start: (input: unknown, options?: StartOptions) => Promise<void>;
    resume: (resumeValue: unknown) => Promise<void>;
    abort: () => void;
    /**
     * Seeds the message list from a prior session (e.g. localStorage).
     * No-op when messages already exist so a double-mount in
     * React.StrictMode can't duplicate the history.
     */
    seedMessages: (initial: AgentMessage[]) => void;
    isStreaming: boolean;
    /**
     * Normalised lifecycle status (Theme 2). `isStreaming` is kept for
     * backwards compatibility; `status` is the preferred surface going forward.
     */
    status: AgentStatus;
    state: UseAgentState;
    pendingInterrupt: InterruptPayload | null;
    pendingProposal: MutationProposal | null;
    citations: CitationRef[];
    /**
     * Active TriageNudges after applying inbox rules (PRD AC-V14):
     *   - newest first;
     *   - at most {@link NUDGE_INBOX_MAX} per (kind, project_id) pair;
     *   - capped at {@link NUDGE_INBOX_MAX} total per board;
     *   - entries older than {@link NUDGE_EXPIRY_MS} are pruned.
     * Use {@link dismissNudge} to remove an item explicitly.
     */
    nudges: TriageNudge[];
    /**
     * The most recent `custom/suggestion` event emitted by the agent.
     * Null until the first suggestion arrives; reset to null at the start
     * of each new `start()` call. Callers use `clearSuggestion()` once
     * they have consumed the value (e.g. applied it to a form field).
     */
    lastSuggestion: AgentSuggestion | null;
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
     * True when the most recent TTFT exceeded {@link TTFT_SLO_MS} (P2-I).
     * Null/false until TTFT is measured. Surfaces use this to show slow-
     * response affordances like "Still thinking…".
     */
    isSlowTtft: boolean;
    /**
     * Clears `pendingProposal` without leaving the agent run going (used
     * after a user accepts/rejects from a UI surface and the parent has
     * already wired the resume call). PRD v3 UA-R3.
     */
    clearPendingProposal: () => void;
    /**
     * Clears `lastSuggestion` once the caller has consumed or dismissed it.
     * Mirrors `clearPendingProposal` pattern.
     */
    clearSuggestion: () => void;
    /**
     * Removes a single nudge from the inbox by `nudge_id`. No-op when the
     * id is unknown. Use this for explicit user-initiated dismissals so the
     * inbox state survives drawer close/reopen for the same triage run.
     */
    dismissNudge: (nudgeId: string) => void;
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
const generateThreadId = (): string => {
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

// ─── sessionStorage helpers (Theme 4) ────────────────────────────────────────

/**
 * Build the sessionStorage key for a given (agentName, projectId) pair so
 * LangGraph checkpoint threads survive page refresh.
 */
const threadStorageKey = (agentName: string, projectId?: string): string =>
    `pulse.agentThread.${agentName}.${projectId ?? "none"}`;

/** Read back a persisted thread id. Returns undefined on SSR or storage error. */
const readPersistedThread = (key: string): string | undefined => {
    if (typeof window === "undefined") return undefined;
    try {
        return sessionStorage.getItem(key) ?? undefined;
    } catch {
        return undefined;
    }
};

/** Write a thread id to sessionStorage. No-ops on SSR or storage errors. */
const writePersistedThread = (key: string, threadId: string): void => {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(key, threadId);
    } catch {
        // Private-mode / quota exceeded — silently ignore.
    }
};

/** Erase a persisted thread id from sessionStorage. */
const clearPersistedThreadStorage = (key: string): void => {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
};

// ─────────────────────────────────────────────────────────────────────────────

interface ApplyStreamPartHandlers {
    setState: (updater: (prev: UseAgentState) => UseAgentState) => void;
    setPendingInterrupt: (payload: InterruptPayload | null) => void;
    setPendingProposal: (proposal: MutationProposal | null) => void;
    setCitations: (refs: CitationRef[]) => void;
    setNudges: (nudge: TriageNudge) => void;
    setLastSuggestion: (suggestion: AgentSuggestion) => void;
    /** Write the latest token counts into a ref so AGENT_TURN_COMPLETED can read them. */
    setLastUsageRef: (usage: { tokensIn: number; tokensOut: number }) => void;
    /** Mid-stream {@link StreamPart} `error` → hook `error` + terminate this SSE read. */
    onMidStreamErrorEnvelope: (err: Error) => void;
    autoResume: boolean;
    ctx: FeToolContext;
}

/**
 * Map a mid-stream SSE `error` envelope to hook-level errors. Aligns with
 * HTTP-era subclasses when `code` matches known server enums.
 */
const hookErrorFromAgentStreamErrorData = (
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

    return new AgentTransportError(message, undefined, code);
};

/**
 * Triage-nudge inbox rules per PRD AC-V14. A nudge entry carries its
 * receipt timestamp so the inbox can apply expiry and dedup-by-kind
 * deterministically without leaking timing into UI components.
 */
interface NudgeEntry {
    nudge: TriageNudge;
    receivedAt: number;
}

/** TTFT SLO threshold in ms (P2-I). Turns exceeding this emit AGENT_TTFT_SLOW. */
const TTFT_SLO_MS = 1500;

/** Maximum active nudges per board (PRD AC-V14). */
export const NUDGE_INBOX_MAX = 5;
/** Auto-expire entries older than 4 hours (PRD AC-V14). */
export const NUDGE_EXPIRY_MS = 4 * 60 * 60 * 1000;
/** Periodic prune cadence; bounded so a stale entry can't linger past a minute. */
export const NUDGE_PRUNE_INTERVAL_MS = 60 * 1000;

/**
 * Apply inbox rules when a new nudge arrives:
 *   1. drop expired entries;
 *   2. drop any prior entry matching `(kind, project_id)` so the newer
 *      one supersedes it;
 *   3. prepend the incoming entry (newest first);
 *   4. cap at {@link NUDGE_INBOX_MAX}.
 * Pure for unit-testability.
 */
export const reduceNudgeInbox = (
    prev: NudgeEntry[],
    incoming: TriageNudge,
    now: number = Date.now()
): NudgeEntry[] => {
    const fresh = prev.filter(
        (entry) =>
            now - entry.receivedAt < NUDGE_EXPIRY_MS &&
            !(
                entry.nudge.kind === incoming.kind &&
                entry.nudge.project_id === incoming.project_id
            )
    );
    return [{ nudge: incoming, receivedAt: now }, ...fresh].slice(
        0,
        NUDGE_INBOX_MAX
    );
};

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
            handlers.onMidStreamErrorEnvelope(
                hookErrorFromAgentStreamErrorData(part.data)
            );
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
    /**
     * `firstChunkReceived` is an internal flag used to derive `status`.
     * It flips from false→true on the first `messages` chunk of each turn
     * and is reset to false at the start of every `runStream` call so the
     * "connecting" window is correctly gated per turn.
     */
    const [firstChunkReceived, setFirstChunkReceived] = useState(false);
    /**
     * `hasEverStarted` tracks whether `start()` was called at least once
     * (or if the hook has been reset back to idle). Used to distinguish
     * "idle" from "terminal".
     */
    const [hasEverStarted, setHasEverStarted] = useState(false);
    const [pendingInterrupt, setPendingInterrupt] =
        useState<InterruptPayload | null>(null);
    const [pendingProposal, setPendingProposal] =
        useState<MutationProposal | null>(null);
    const [citations, setCitations] = useState<CitationRef[]>([]);
    const [nudgeEntries, setNudgeEntries] = useState<NudgeEntry[]>([]);
    const [lastSuggestion, setLastSuggestion] =
        useState<AgentSuggestion | null>(null);

    // Thread ID — prefer caller-supplied override, then sessionStorage, then generate fresh.
    // Keep the key in a ref so closures in reset() always read the current value.
    const storageKeyRef = useRef<string>(
        threadStorageKey(name, options.projectId)
    );
    storageKeyRef.current = threadStorageKey(name, options.projectId);
    const storageKey = storageKeyRef.current;
    const [threadId, setThreadId] = useState<string>(() => {
        if (options.initialThreadId) {
            writePersistedThread(storageKey, options.initialThreadId);
            return options.initialThreadId;
        }
        const persisted = readPersistedThread(storageKey);
        if (persisted) return persisted;
        const fresh = generateThreadId();
        writePersistedThread(storageKey, fresh);
        return fresh;
    });

    const [ttftMs, setTtftMs] = useState<number | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const threadIdRef = useRef<string>(threadId);
    const lastInputRef = useRef<unknown>(null);
    const autonomyRef = useRef<AutonomyLevel>("plan");
    const autoResumeRef = useRef<boolean>(true);

    // Gap B: sync autonomyRef with the user's persisted autonomy level so
    // start() calls without an explicit `autonomy` option honor the setting.
    const { level: autonomyLevel } = useAutonomyLevel();
    useEffect(() => {
        autonomyRef.current = autonomyLevel;
    }, [autonomyLevel]);
    const mountedRef = useRef(true);
    /**
     * TTFT bookkeeping. `streamStartRef` records the `performance.now()`
     * that consumeStream began; `ttftSeenRef` flips after the first
     * `messages` chunk so we only emit once per turn (UA-R2).
     */
    const streamStartRef = useRef<number | null>(null);
    const ttftSeenRef = useRef(false);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Latest token counts from the "usage" custom event — read at AGENT_TURN_COMPLETED. */
    const lastUsageRef = useRef<{ tokensIn: number; tokensOut: number } | null>(
        null
    );

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
            ctx: FeToolContext
        ): Promise<{
            pendingResume: unknown | undefined;
            streamFailed: boolean;
        }> => {
            let pendingResume: unknown | undefined;
            let terminatedByStreamError = false;
            // Watchdog: if no stream chunk arrives for STREAM_WATCHDOG_MS,
            // abort the run and surface a "took too long" error (UA-R1).
            const armWatchdog = () => {
                clearWatchdog();
                watchdogRef.current = setTimeout(() => {
                    controllerRef.current?.abort();
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
                        if (mountedRef.current) setFirstChunkReceived(true);
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
                        if (elapsed > TTFT_SLO_MS) {
                            track(ANALYTICS_EVENTS.AGENT_TTFT_SLOW, {
                                agent: name,
                                ttftMs: elapsed
                            });
                        }
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
                            setNudgeEntries((prev) =>
                                reduceNudgeInbox(prev, n)
                            ),
                        setLastSuggestion: (s) =>
                            mountedRef.current && setLastSuggestion(s),
                        setLastUsageRef: (usage) => {
                            lastUsageRef.current = usage;
                        },
                        onMidStreamErrorEnvelope: (streamErr) => {
                            terminatedByStreamError = true;
                            if (mountedRef.current) setError(streamErr);
                        },
                        autoResume: autoResumeRef.current,
                        ctx
                    });
                    if (pendingResume !== undefined) break;
                    if (terminatedByStreamError) break;
                }
            } catch (err) {
                if (err instanceof Error && err.name !== "AbortError") {
                    if (mountedRef.current) setError(err);
                    return { pendingResume: undefined, streamFailed: true };
                }
            } finally {
                clearWatchdog();
            }
            if (terminatedByStreamError) {
                return { pendingResume: undefined, streamFailed: true };
            }
            return { pendingResume, streamFailed: false };
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
            setFirstChunkReceived(false);
            setHasEverStarted(true);
            // Reset TTFT bookkeeping for the new turn (UA-R2).
            streamStartRef.current = performance.now();
            ttftSeenRef.current = false;
            if (mountedRef.current) setTtftMs(null);

            // Observability P2-5: fire AGENT_TURN_STARTED when the stream opens.
            lastUsageRef.current = null;
            track(ANALYTICS_EVENTS.AGENT_TURN_STARTED, { agentName: name });

            const baseCtx: FeToolContext = {
                queryClient,
                projectId: options.projectId,
                userId: options.userId,
                autonomyLevel: autonomyRef.current,
                ...(options.feToolContext ?? {})
            };

            let turnErrored = false;
            try {
                let nextBody = body;
                // Auto-resume loop: if the agent interrupts with a known FE
                // tool, run the tool synchronously and POST a `resume` body.
                let loopExhausted = false;
                for (let round = 0; round < 8; round += 1) {
                    if (controller.signal.aborted) break;
                    const { pendingResume, streamFailed } = await consumeStream(
                        nextBody,
                        controller.signal,
                        baseCtx
                    );
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
                    // Clear interrupt state on successful auto-resume.
                    if (mountedRef.current) setPendingInterrupt(null);
                    if (round === 7) {
                        // All 8 rounds consumed and the last still requested
                        // a resume — the agent never produced a final answer.
                        loopExhausted = true;
                    }
                }
                if (
                    loopExhausted &&
                    !turnErrored &&
                    !controller.signal.aborted &&
                    mountedRef.current
                ) {
                    // Inspect the latest messages via a state updater so we
                    // read the post-stream value, not the stale closure value.
                    let hasRealAnswer = false;
                    setState((prev) => {
                        const lastMsg = prev.messages[prev.messages.length - 1];
                        hasRealAnswer =
                            lastMsg?.role === "assistant" &&
                            lastMsg.content.trim().length > 0;
                        return prev; // no change to state, just a read
                    });
                    if (!hasRealAnswer) {
                        setError(
                            new Error(microcopy.ai.toolRoundExhausted as string)
                        );
                        turnErrored = true;
                    }
                }
            } catch (err) {
                // already surfaced
                turnErrored = true;
                void err;
            } finally {
                clearWatchdog();
                // Observability P2-5: fire AGENT_TURN_COMPLETED on natural
                // completion or terminal error. Do NOT fire on aborts
                // (user-initiated, not turn outcomes).
                if (!controller.signal.aborted) {
                    const durationMs =
                        streamStartRef.current !== null
                            ? Math.round(
                                  performance.now() - streamStartRef.current
                              )
                            : 0;
                    // Usage is captured via the "usage" custom event and
                    // stored in lastUsageRef so it's readable here in the
                    // finally block without closure-staleness issues.
                    const usageSnap = lastUsageRef.current as {
                        tokensIn: number;
                        tokensOut: number;
                    } | null;
                    const tokensIn =
                        usageSnap !== null ? usageSnap.tokensIn : 0;
                    const tokensOut =
                        usageSnap !== null ? usageSnap.tokensOut : 0;
                    track(ANALYTICS_EVENTS.AGENT_TURN_COMPLETED, {
                        agentName: name,
                        durationMs,
                        tokensIn,
                        tokensOut,
                        ...(turnErrored ? { error: true } : {})
                    });
                }
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
            // Per-turn reset (review follow-up #10): citations, nudges, and
            // lastSuggestion are scoped to a single user turn, so each new
            // `start()` call discards the previous turn's surfaces. Multi-turn
            // within one `start()` (auto-resume loop) continues to accumulate
            // inside `consumeStream` so the agent can stream multiple citations
            // for a single answer.
            setCitations([]);
            setNudgeEntries([]);
            setLastSuggestion(null);
            const inputPayload =
                typeof input === "string"
                    ? {
                          messages: [{ role: "user" as const, content: input }]
                      }
                    : input &&
                        typeof input === "object" &&
                        !Array.isArray(input)
                      ? (input as Record<string, unknown>)
                      : { messages: [] };
            const messages =
                (inputPayload.messages as AgentMessage[] | undefined) ?? [];

            // Reflect the user message immediately so chat UIs feel instant.
            safeSetState((prev) => ({
                ...prev,
                messages: [...prev.messages, ...messages]
            }));

            // NOTE: `user_id` is intentionally NOT placed on the wire here.
            // The agent server derives identity from the JWT in
            // `Authorization` and rejects any client-supplied `user_id` in
            // `configurable` with HTTP 400 to prevent identity spoofing
            // (see `backend/app/routers/agents.py::_normalize_payload`).
            // `options.userId` is still consumed above for FE-internal
            // bookkeeping (e.g. `feToolContext.userId`).
            await runStream({
                input: inputPayload,
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
        setNudgeEntries([]);
        setLastSuggestion(null);
        setError(null);
        setIsStreaming(false);
        setFirstChunkReceived(false);
        setHasEverStarted(false);
        setTtftMs(null);
        clearPersistedThreadStorage(storageKeyRef.current);
        const next = generateThreadId();
        writePersistedThread(storageKeyRef.current, next);
        threadIdRef.current = next;
        setThreadId(next);
        ttftSeenRef.current = false;
        streamStartRef.current = null;
    }, [clearWatchdog]);

    const clearPendingProposal = useCallback(() => {
        if (mountedRef.current) setPendingProposal(null);
    }, []);

    const clearSuggestion = useCallback(() => {
        if (mountedRef.current) setLastSuggestion(null);
    }, []);

    const seedMessages = useCallback((initial: AgentMessage[]) => {
        if (!mountedRef.current) return;
        setState((prev) => {
            if (prev.messages.length > 0 || initial.length === 0) return prev;
            return { ...prev, messages: initial };
        });
    }, []);

    const dismissNudge = useCallback((nudgeId: string) => {
        if (!mountedRef.current) return;
        setNudgeEntries((prev) => {
            const next = prev.filter(
                (entry) => entry.nudge.nudge_id !== nudgeId
            );
            return next.length === prev.length ? prev : next;
        });
    }, []);

    /**
     * Periodic expiry sweep (PRD AC-V14: 4-hour rolling window). Without
     * this, an entry that aged past the cutoff between turns would remain
     * visible until the next inbox mutation. The interval is cheap because
     * it short-circuits when nothing changes.
     */
    useEffect(() => {
        const tick = () => {
            const now = Date.now();
            setNudgeEntries((prev) => {
                const fresh = prev.filter(
                    (entry) => now - entry.receivedAt < NUDGE_EXPIRY_MS
                );
                return fresh.length === prev.length ? prev : fresh;
            });
        };
        const id = setInterval(tick, NUDGE_PRUNE_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    const nudges = useMemo<TriageNudge[]>(
        () => nudgeEntries.map((entry) => entry.nudge),
        [nudgeEntries]
    );

    /**
     * Derived `status` — computed from existing state, no new state machine.
     *
     *   idle        — never started (or reset() since last start).
     *   connecting  — stream in flight but no message chunk yet.
     *   streaming   — at least one message chunk received and still running.
     *   interrupted — pendingInterrupt is set (awaiting human / FE tool).
     *   terminal    — last run finished (completed, error, or cancelled).
     */
    const status = useMemo<AgentStatus>(() => {
        if (pendingInterrupt !== null) return "interrupted";
        if (isStreaming) {
            return firstChunkReceived ? "streaming" : "connecting";
        }
        if (!hasEverStarted) return "idle";
        return "terminal";
    }, [pendingInterrupt, isStreaming, firstChunkReceived, hasEverStarted]);

    return useMemo(
        () => ({
            start,
            resume,
            abort,
            seedMessages,
            isStreaming,
            status,
            state,
            pendingInterrupt,
            pendingProposal,
            citations,
            nudges,
            lastSuggestion,
            error,
            reset,
            threadId,
            ttftMs,
            isSlowTtft: ttftMs !== null && ttftMs > TTFT_SLO_MS,
            clearPendingProposal,
            clearSuggestion,
            dismissNudge
        }),
        [
            abort,
            citations,
            clearPendingProposal,
            clearSuggestion,
            dismissNudge,
            error,
            isStreaming,
            status,
            lastSuggestion,
            nudges,
            pendingInterrupt,
            pendingProposal,
            reset,
            resume,
            seedMessages,
            start,
            state,
            threadId,
            ttftMs
        ]
    );
};

export default useAgent;
