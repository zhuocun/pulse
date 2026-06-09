import { useCallback, useMemo, useState } from "react";

import environment from "../../constants/env";
import {
    buildRewritePrompt,
    rewriteNoteLocally,
    type RewriteRequest
} from "../ai/rewrite";
import useAgent, { generateThreadId, type AgentMessage } from "./useAgent";

export interface UseRewriteResult {
    /** Latest rewrite text — partial while streaming, final when settled. */
    result: string;
    isStreaming: boolean;
    error: Error | null;
    /** Kick off a rewrite for the given request. Safe to call repeatedly. */
    run: (request: RewriteRequest) => void;
    /** Abort an in-flight remote stream. No-op for the local engine. */
    abort: () => void;
}

/**
 * The newest assistant turn for the current run: the assistant text that
 * follows the most recent user message. Reading "after the last user
 * message" (rather than the last assistant message anywhere) means a fresh
 * `run()` clears the previous output during the connecting window instead
 * of flashing the prior rewrite.
 */
const latestAssistantTurn = (messages: AgentMessage[]): string => {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") {
            lastUser = i;
            break;
        }
    }
    let text = "";
    for (let i = lastUser + 1; i < messages.length; i += 1) {
        if (messages[i].role === "assistant") text = messages[i].content;
    }
    return text;
};

/**
 * "Rewrite with AI" engine binding (PRD-GAP-012). Mirrors the dual-engine
 * split the rest of the AI surface uses: the remote path streams through
 * the `chat-agent` plumbing, the local path runs the deterministic
 * {@link rewriteNoteLocally} rules synchronously.
 *
 * Each remote `run()` starts on a fresh, non-persisted thread id so a
 * rewrite never bleeds into — or inherits from — the user's chat-dock
 * conversation that shares the `chat-agent` name.
 */
const useRewrite = (projectId?: string): UseRewriteResult => {
    const isRemote = !environment.aiUseLocalEngine;
    const agent = useAgent("chat-agent", { projectId });
    const {
        start: agentStart,
        abort: agentAbort,
        state,
        isStreaming: agentStreaming,
        error: agentError
    } = agent;

    const [localResult, setLocalResult] = useState("");

    const remoteResult = useMemo(
        () => latestAssistantTurn(state.messages),
        [state.messages]
    );

    const run = useCallback(
        (request: RewriteRequest) => {
            if (isRemote) {
                void agentStart(
                    {
                        messages: [
                            {
                                role: "user",
                                content: buildRewritePrompt(request)
                            }
                        ]
                    },
                    { threadId: generateThreadId(), autonomy: "plan" }
                ).catch(() => {
                    // Failures surface through `agent.error`; the void catch
                    // keeps callers from needing their own rejection handler.
                });
            } else {
                setLocalResult(rewriteNoteLocally(request));
            }
        },
        [isRemote, agentStart]
    );

    return {
        result: isRemote ? remoteResult : localResult,
        isStreaming: isRemote ? agentStreaming : false,
        error: isRemote ? agentError : null,
        run,
        abort: agentAbort
    };
};

export default useRewrite;
