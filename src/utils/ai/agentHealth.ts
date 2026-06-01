import { getAgentHealth } from "./agentClient";
import type { AgentHealthResponse } from "../../interfaces/agent";

export type AgentPingResult = AgentHealthResponse;

const unavailablePing: AgentPingResult = {
    ok: false,
    agentsLoaded: 0,
    latencyMs: -1,
    ready: false,
    realProviderReady: false,
    provider: null,
    model: null,
    stubMode: false,
    issues: [],
    warnings: []
};

/**
 * Best-effort readiness probe for the agent server. Returns the structured
 * AI-readiness payload plus round-trip latency; on any error we surface an
 * offline-shaped result so callers can render availability without
 * re-implementing error mapping.
 */
export const pingAgent = async (
    baseUrl: string,
    signal?: AbortSignal
): Promise<AgentPingResult> => {
    if (!baseUrl) return unavailablePing;
    const started = Date.now();
    try {
        const result = await getAgentHealth({ baseUrl, signal });
        return {
            ...result,
            latencyMs: result.latencyMs ?? Date.now() - started
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        return unavailablePing;
    }
};
