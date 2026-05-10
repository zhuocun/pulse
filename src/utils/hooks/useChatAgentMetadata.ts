import { useEffect, useState } from "react";

import environment from "../../constants/env";
import type { AgentMetadata } from "../../interfaces/agent";
import { getSessionCachedAgentMetadata } from "../ai/agentClient";

export type ChatAgentMetadataState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; data: AgentMetadata }
    | { status: "error" };

const CHAT_AGENT_NAME = "chat-agent";

/**
 * Loads `GET /api/v1/agents/chat-agent` once per remote session (cached in
 * {@link getSessionCachedAgentMetadata}). No network when the local engine
 * is active, AI is disabled, or the AI base URL is empty.
 */
const useChatAgentMetadata = (): ChatAgentMetadataState => {
    const baseUrl = environment.aiBaseUrl;
    const remoteConfigured =
        !environment.aiUseLocalEngine &&
        baseUrl.length > 0 &&
        environment.aiEnabled;

    const [state, setState] = useState<ChatAgentMetadataState>(() =>
        remoteConfigured ? { status: "loading" } : { status: "idle" }
    );

    useEffect(() => {
        if (!remoteConfigured) {
            setState({ status: "idle" });
            return;
        }

        let cancelled = false;
        const controller = new AbortController();
        setState({ status: "loading" });

        getSessionCachedAgentMetadata({
            name: CHAT_AGENT_NAME,
            baseUrl,
            signal: controller.signal
        })
            .then((data) => {
                if (!cancelled) setState({ status: "ready", data });
            })
            .catch((err) => {
                if (cancelled) return;
                if (err instanceof Error && err.name === "AbortError") return;
                setState({ status: "error" });
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [remoteConfigured, baseUrl]);

    return state;
};

export default useChatAgentMetadata;
