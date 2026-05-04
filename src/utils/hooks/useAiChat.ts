import { useCallback, useEffect, useRef, useState } from "react";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import type { CitationRef } from "../../interfaces/agent";
import {
    chatAssistantTurn,
    citationsFromToolResult,
    summarizeToolResultForUser,
    type AiChatMessage,
    type ChatEngineContext,
    type ChatTurnResult
} from "../ai/chatEngine";
import { sanitizeRemotePayloadForRoute } from "../ai/aiDataScope";
import {
    executeChatToolCall,
    type AiChatExecutionContext,
    type AiChatToolCall
} from "../ai/chatTools";
import { getStoredBearerAuthHeader } from "../aiAuthHeader";
import { parseFetchBody } from "../parseFetchBody";
import { rewriteNetworkFetchError } from "../networkFetchError";

import { newIdempotencyKey } from "../ai/idempotencyKey";
import { mapErrorResponse } from "../ai/mapErrorResponse";
import {
    isProjectAiDisabled,
    PROJECT_AI_DISABLED_MESSAGE
} from "../ai/projectAiStorage";

import useApi from "./useApi";

const MAX_TOOL_ROUNDS = 5;

const humanizeTool = (name: string) =>
    name.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

export type { AiChatMessage };

export interface UseAiChatContext {
    engine: ChatEngineContext;
    execution: AiChatExecutionContext;
}

const remoteChatStep = async (
    messages: AiChatMessage[],
    context: ChatEngineContext,
    signal: AbortSignal
): Promise<ChatTurnResult> => {
    const authHeader = getStoredBearerAuthHeader();
    /*
     * Chat sends task notes today (see `AI_DATA_SCOPES.chat`) so the
     * sanitizer is a no-op here. Wiring it through anyway means a future
     * change to `AI_DATA_SCOPES.chat.sendsNotes = false` automatically
     * scrubs the payload — the contract stays in one place.
     */
    const sanitized = sanitizeRemotePayloadForRoute("chat", {
        messages,
        context
    });
    const idempotencyKey = newIdempotencyKey();
    let response: Response;
    try {
        response = await fetch(`${environment.aiBaseUrl}/api/ai/chat`, {
            body: JSON.stringify(sanitized),
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
                ...(authHeader ? { Authorization: authHeader } : {})
            },
            method: "POST",
            signal
        });
    } catch (err) {
        const rewritten = rewriteNetworkFetchError(err);
        if (rewritten) {
            throw rewritten;
        }
        throw err;
    }
    if (!response.ok) {
        throw await mapErrorResponse(response);
    }
    return (await parseFetchBody(response)) as ChatTurnResult;
};

const useAiChat = (ctx: UseAiChatContext | null) => {
    const api = useApi();
    const [messages, setMessages] = useState<AiChatMessage[]>([]);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [streamingText, setStreamingText] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        // Re-arm `mountedRef` on every mount so React.StrictMode's
        // mount→unmount→remount dev cycle doesn't leave it stuck at `false`.
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    const abort = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setIsLoading(false);
        setStreamingText("");
    }, []);

    const reset = useCallback(() => {
        abort();
        setMessages([]);
        setError(null);
    }, [abort]);

    const runConversationStep = useCallback(
        async (
            thread: AiChatMessage[],
            signal: AbortSignal
        ): Promise<ChatTurnResult> => {
            if (!ctx) throw new Error("Chat context unavailable");
            if (environment.aiUseLocalEngine) {
                return chatAssistantTurn(thread, ctx.engine);
            }
            return remoteChatStep(thread, ctx.engine, signal);
        },
        [ctx]
    );

    const send = useCallback(
        async (userText: string) => {
            const trimmed = userText.trim();
            if (!trimmed || !ctx) return;

            if (isProjectAiDisabled(ctx.execution.projectId)) {
                setError(new Error(PROJECT_AI_DISABLED_MESSAGE));
                return;
            }

            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            const { signal } = controller;

            const userMessage: AiChatMessage = {
                role: "user",
                content: trimmed
            };
            setError(null);
            setIsLoading(true);
            setStreamingText("");

            let thread = [...messagesRef.current, userMessage];
            setMessages(thread);

            /*
             * Per-turn citation buffer (Optimization Plan §3 P0-3). Each
             * tool result populated by the loop below contributes typed
             * citations; we attach the deduped set to the assistant
             * message that finalizes the turn so older messages keep their
             * sources after later turns arrive.
             */
            const turnCitations: CitationRef[] = [];
            const seenCitationKey = new Set<string>();
            const pushCitations = (refs: CitationRef[]) => {
                for (const ref of refs) {
                    const key = `${ref.source}:${ref.id}`;
                    if (seenCitationKey.has(key)) continue;
                    seenCitationKey.add(key);
                    turnCitations.push(ref);
                    if (turnCitations.length >= 4) return;
                }
            };

            try {
                let finished = false;
                for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
                    if (signal.aborted) break;

                    const turn = await runConversationStep(thread, signal);
                    if (signal.aborted) break;

                    if (turn.kind === "text") {
                        const assistant: AiChatMessage = {
                            role: "assistant",
                            content: turn.text,
                            citations: turnCitations.slice()
                        };
                        thread = [...thread, assistant];
                        setMessages(thread);
                        finished = true;
                        break;
                    }

                    if (!turn.toolCalls?.length) {
                        const fallback: AiChatMessage = {
                            role: "assistant",
                            content: microcopy.ai.unexpectedResponse,
                            citations: turnCitations.slice()
                        };
                        thread = [...thread, fallback];
                        setMessages(thread);
                        finished = true;
                        break;
                    }

                    /*
                     * Replay context preservation for the remote LLM.
                     *
                     * Append a hidden assistant turn that carries the
                     * `toolCalls` payload before the per-tool results. The
                     * chat drawer suppresses turns where `content === ""`
                     * and `toolCalls?.length > 0`, so this is invisible to
                     * the user — but `remoteChatStep` serializes it on the
                     * next request so the BE shim's `_build_chat_messages`
                     * helper can hydrate `AIMessage.tool_calls`. Without
                     * that, Anthropic 400s ("tool_result block references
                     * unknown tool_use id") and OpenAI silently drops
                     * context on every multi-round answer.
                     */
                    const assistantToolTurn: AiChatMessage = {
                        role: "assistant",
                        content: "",
                        toolCalls: turn.toolCalls.map((c) => ({ ...c }))
                    };
                    thread = [...thread, assistantToolTurn];
                    setMessages(thread);

                    for (const call of turn.toolCalls) {
                        if (signal.aborted) break;
                        const payload = await executeChatToolCall(
                            api,
                            ctx.execution,
                            call as AiChatToolCall,
                            signal
                        );
                        pushCitations(
                            citationsFromToolResult(call.name, payload)
                        );
                        const summary = summarizeToolResultForUser(
                            call.name,
                            payload
                        );
                        const toolMsg: AiChatMessage = {
                            role: "tool",
                            content: summary,
                            toolCallId: call.id,
                            toolName: call.name
                        };
                        thread = [...thread, toolMsg];
                        setMessages(thread);
                        if (mountedRef.current) {
                            setStreamingText(`${humanizeTool(call.name)}…`);
                        }
                    }
                }

                if (
                    !finished &&
                    !signal.aborted &&
                    thread[thread.length - 1]?.role !== "assistant"
                ) {
                    const assistant: AiChatMessage = {
                        role: "assistant",
                        content: microcopy.ai.toolRoundExhausted,
                        citations: turnCitations.slice()
                    };
                    thread = [...thread, assistant];
                    setMessages(thread);
                }
            } catch (err) {
                const wrapped =
                    err instanceof Error ? err : new Error(String(err));
                if (!signal.aborted && mountedRef.current) {
                    setError(wrapped);
                }
            } finally {
                if (
                    mountedRef.current &&
                    controllerRef.current === controller
                ) {
                    setIsLoading(false);
                    setStreamingText("");
                    controllerRef.current = null;
                }
            }
        },
        [api, ctx, runConversationStep]
    );

    const dismissError = useCallback(() => setError(null), []);

    return {
        abort,
        dismissError,
        error,
        isLoading,
        messages,
        reset,
        send,
        streamingText
    };
};

export default useAiChat;
