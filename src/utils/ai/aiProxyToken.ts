import environment from "../../constants/env";
import { readAiProxyToken, writeAiProxyToken } from "../tokenStorage";

import { AgentTransportError } from "./agentErrors";
import { mapAgentErrorResponse } from "./mapErrorResponse";

interface AiProxyTokenResponse {
    ai_jwt?: unknown;
}

const TOKEN_EXPIRY_SKEW_MS = 30_000;

const parseBase64UrlJson = (segment: string): unknown => {
    if (typeof globalThis.atob !== "function") return null;
    const padded = segment
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(segment.length / 4) * 4, "=");
    try {
        return JSON.parse(globalThis.atob(padded)) as unknown;
    } catch {
        return null;
    }
};

const getJwtExpiryMs = (token: string): number | null => {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const decoded = parseBase64UrlJson(payload);
    if (typeof decoded !== "object" || decoded === null) return null;
    const exp = (decoded as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
};

export const isAiProxyTokenFresh = (
    token: string,
    nowMs = Date.now()
): boolean => {
    const expiryMs = getJwtExpiryMs(token);
    return expiryMs === null || expiryMs - TOKEN_EXPIRY_SKEW_MS > nowMs;
};

export const refreshAiProxyToken = async (
    signal?: AbortSignal
): Promise<string> => {
    let response: Response;
    try {
        response = await fetch(`${environment.apiBaseUrl}/auth/ai-token`, {
            credentials: "include",
            method: "POST",
            signal
        });
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        throw new AgentTransportError(
            err instanceof Error ? err.message : String(err),
            err
        );
    }
    if (!response.ok) {
        throw await mapAgentErrorResponse(response);
    }
    const body = (await response.json()) as AiProxyTokenResponse;
    if (typeof body.ai_jwt !== "string" || body.ai_jwt.length === 0) {
        throw new AgentTransportError("AI token refresh returned no token");
    }
    writeAiProxyToken(body.ai_jwt);
    return body.ai_jwt;
};

export const ensureFreshAiProxyToken = async (
    signal?: AbortSignal
): Promise<string> => {
    const current = readAiProxyToken();
    if (current && isAiProxyTokenFresh(current)) return current;
    return refreshAiProxyToken(signal);
};
