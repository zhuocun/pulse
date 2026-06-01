import type {
    AgentHealthResponse,
    AgentListResponse,
    AgentMetadata,
    AgentStreamRequest,
    StreamPart
} from "../../interfaces/agent";
import environment from "../../constants/env";
import { getStoredBearerAuthHeader } from "../aiAuthHeader";
import { ensureFreshAiProxyToken } from "./aiProxyToken";
import {
    AgentAuthError,
    AgentBudgetError,
    AgentForbiddenError,
    AgentNotFoundError,
    AgentRateLimitError,
    AgentServerError,
    AgentTransportError
} from "./agentErrors";
import { newIdempotencyKey } from "./idempotencyKey";
import { mapAgentErrorResponse } from "./mapErrorResponse";

export {
    AgentAuthError,
    AgentBudgetError,
    AgentForbiddenError,
    AgentNotFoundError,
    AgentRateLimitError,
    AgentServerError,
    AgentTransportError
} from "./agentErrors";

/**
 * Typed transport over the LangGraph v2 `agents/{name}/stream` endpoint
 * (PRD §5.3). Streaming uses SSE — chunks are split on `\n\n`, comment and
 * `event: ` lines are dropped, and every `data: …` payload is parsed as a
 * `StreamPart`. Errors map to typed subclasses so the hook layer can react
 * without re-parsing strings.
 *
 * The v1 fallback in `useAi.ts` / `useAiChat.ts` stays untouched: when
 * `REACT_APP_AI_BASE_URL` is empty the agent client is never reached.
 */

interface BaseRequest {
    baseUrl: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}

interface AgentEnvelopeRequest extends BaseRequest {
    name: string;
    body: AgentStreamRequest;
}

interface AgentByNameRequest extends BaseRequest {
    name: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

const buildHeaders = (
    extra?: Record<string, string>,
    aiProxyToken?: string
): Record<string, string> => {
    const auth = aiProxyToken
        ? `Bearer ${aiProxyToken}`
        : getStoredBearerAuthHeader();
    const base: Record<string, string> = {
        "Content-Type": "application/json"
    };
    if (auth) base.Authorization = auth;
    return { ...base, ...(extra ?? {}) };
};

const wrapNetworkError = (err: unknown): Error => {
    if (err instanceof Error && err.name === "AbortError") return err;
    if (
        err instanceof AgentTransportError ||
        err instanceof AgentAuthError ||
        err instanceof AgentForbiddenError ||
        err instanceof AgentBudgetError ||
        err instanceof AgentRateLimitError ||
        err instanceof AgentNotFoundError ||
        err instanceof AgentServerError
    ) {
        return err;
    }
    return new AgentTransportError(
        err instanceof Error ? err.message : String(err),
        err
    );
};

/** Normalises unknown stream failures into typed `Agent*` errors for the hook layer. */
export const coerceAgentTransportError = wrapNetworkError;

const checkAlreadyAborted = (signal: AbortSignal | undefined) => {
    if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
    }
};

const parseSseLine = (chunk: string): StreamPart | null => {
    const lines = chunk.split("\n");
    const dataLines: string[] = [];
    for (const line of lines) {
        if (!line) continue;
        if (line.startsWith(":")) continue; // SSE comment
        if (line.startsWith("event:")) continue;
        // SSE spec (whatwg HTML §9.2.6): strip exactly one leading space
        // after `data:`. Do NOT trim — trailing whitespace inside string
        // values must be preserved (e.g. "ok " ≠ "ok").
        if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5));
        }
    }
    if (dataLines.length === 0) return null;
    const payload = dataLines.join("\n");
    const trimmedProbe = payload.trim();
    if (!trimmedProbe || trimmedProbe === "[DONE]") return null;
    try {
        return JSON.parse(payload) as StreamPart;
    } catch (cause) {
        throw new AgentTransportError(
            "Malformed agent stream event (invalid JSON)",
            cause,
            "sse_invalid_json"
        );
    }
};

/**
 * Open a streaming agent run and yield decoded `StreamPart`s. Caller owns
 * the AbortController; canceling the signal closes the underlying reader.
 */
export async function* streamAgent({
    name,
    body,
    signal,
    baseUrl,
    headers
}: AgentEnvelopeRequest): AsyncGenerator<StreamPart, void, void> {
    checkAlreadyAborted(signal);
    const aiProxyToken = await ensureFreshAiProxyToken(signal);
    const idempotencyKey = newIdempotencyKey();
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/agents/${encodeURIComponent(name)}/stream`,
            {
                body: JSON.stringify(body),
                headers: buildHeaders(
                    {
                        Accept: "text/event-stream",
                        "Idempotency-Key": idempotencyKey,
                        ...(headers ?? {})
                    },
                    aiProxyToken
                ),
                method: "POST",
                signal
            }
        );
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapAgentErrorResponse(response);
    }
    const reader = response.body?.getReader();
    if (!reader) {
        throw new AgentTransportError("Agent stream has no readable body");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            checkAlreadyAborted(signal);
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let separator = buffer.indexOf("\n\n");
            while (separator >= 0) {
                const chunk = buffer.slice(0, separator);
                buffer = buffer.slice(separator + 2);
                const parsed = parseSseLine(chunk);
                if (parsed) yield parsed;
                separator = buffer.indexOf("\n\n");
            }
        }
        const tail = buffer.trim();
        if (tail) {
            const parsed = parseSseLine(tail);
            if (parsed) yield parsed;
        }
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        throw wrapNetworkError(err);
    } finally {
        try {
            reader.releaseLock();
        } catch {
            /* lock already released */
        }
    }
}

export const invokeAgent = async <T = unknown>({
    name,
    body,
    signal,
    baseUrl,
    headers
}: AgentEnvelopeRequest): Promise<T> => {
    checkAlreadyAborted(signal);
    const aiProxyToken = await ensureFreshAiProxyToken(signal);
    const idempotencyKey = newIdempotencyKey();
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/agents/${encodeURIComponent(name)}/invoke`,
            {
                body: JSON.stringify(body),
                headers: buildHeaders(
                    {
                        "Idempotency-Key": idempotencyKey,
                        ...(headers ?? {})
                    },
                    aiProxyToken
                ),
                method: "POST",
                signal
            }
        );
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapAgentErrorResponse(response);
    }
    return (await response.json()) as T;
};

export const listAgents = async ({
    baseUrl,
    headers,
    signal
}: BaseRequest): Promise<AgentListResponse> => {
    checkAlreadyAborted(signal);
    const aiProxyToken = await ensureFreshAiProxyToken(signal);
    let response: Response;
    try {
        response = await fetch(`${trimSlash(baseUrl)}/api/v1/agents`, {
            headers: buildHeaders(headers, aiProxyToken),
            method: "GET",
            signal
        });
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapAgentErrorResponse(response);
    }
    return (await response.json()) as AgentListResponse;
};

/**
 * Knowledge-cutoff label for About Copilot and similar disclosures.
 * Prefers wire `knowledge_cutoff` when present; otherwise
 * `environment.aiKnowledgeCutoff` (`REACT_APP_AI_KNOWLEDGE_CUTOFF`).
 */
export const resolveAiKnowledgeCutoffForUi = (
    metadata?: Pick<AgentMetadata, "knowledge_cutoff"> | null
): string => {
    const wire = metadata?.knowledge_cutoff?.trim();
    if (wire) return wire;
    return environment.aiKnowledgeCutoff;
};

export const getAgentMetadata = async ({
    name,
    baseUrl,
    headers,
    signal
}: AgentByNameRequest): Promise<AgentMetadata> => {
    checkAlreadyAborted(signal);
    const aiProxyToken = await ensureFreshAiProxyToken(signal);
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/agents/${encodeURIComponent(name)}`,
            {
                headers: buildHeaders(headers, aiProxyToken),
                method: "GET",
                signal
            }
        );
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapAgentErrorResponse(response);
    }
    return (await response.json()) as AgentMetadata;
};

const metadataSessionCache = new Map<string, AgentMetadata>();

const sessionCacheKey = (baseUrl: string, name: string) =>
    `${trimSlash(baseUrl)}::${name}`;

/**
 * Like {@link getAgentMetadata}, but returns a single in-memory result per
 * `(baseUrl, name)` for the lifetime of the page session (tab reload clears).
 */
export const getSessionCachedAgentMetadata = async (
    params: AgentByNameRequest
): Promise<AgentMetadata> => {
    const key = sessionCacheKey(params.baseUrl, params.name);
    const hit = metadataSessionCache.get(key);
    if (hit) return hit;
    const fresh = await getAgentMetadata(params);
    metadataSessionCache.set(key, fresh);
    return fresh;
};

/** Test-only: clears the session metadata cache between cases. */
export const clearAgentMetadataSessionCache = (): void => {
    metadataSessionCache.clear();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const readBoolean = (
    body: Record<string, unknown>,
    keys: readonly string[]
): boolean | undefined => {
    for (const key of keys) {
        const value = body[key];
        if (typeof value === "boolean") return value;
    }
    return undefined;
};

const readNumber = (
    body: Record<string, unknown>,
    keys: readonly string[]
): number | undefined => {
    for (const key of keys) {
        const value = body[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
};

const readString = (
    body: Record<string, unknown>,
    keys: readonly string[]
): string | undefined => {
    for (const key of keys) {
        const value = body[key];
        if (typeof value === "string") return value;
    }
    return undefined;
};

const readStringArray = (
    body: Record<string, unknown>,
    keys: readonly string[]
): string[] => {
    for (const key of keys) {
        const value = body[key];
        if (Array.isArray(value)) {
            return value.filter(
                (item): item is string => typeof item === "string"
            );
        }
    }
    return [];
};

const readProviderConnectivity = (
    body: Record<string, unknown>
): AgentHealthResponse["providerConnectivity"] => {
    const raw = body.providerConnectivity ?? body.provider_connectivity;
    if (!isRecord(raw)) return undefined;
    const reachable = readBoolean(raw, ["reachable"]);
    const detail = readString(raw, ["detail"]);
    if (reachable === undefined || detail === undefined) return undefined;
    return {
        reachable,
        detail,
        checkedAt: readNumber(raw, ["checkedAt", "checked_at"]) ?? null
    };
};

/**
 * Coerce the server-side health flag. Returns `undefined` (not `false`)
 * when the body has no opinion so the caller can fall back to the HTTP
 * status. A naive `body.ok ?? body.status === "ok" ?? response.ok`
 * collapses by precedence into `?? false ?? response.ok` and the third
 * branch is unreachable.
 */
const inferOkFromBody = (
    body: Record<string, unknown>
): boolean | undefined => {
    const explicitOk = readBoolean(body, ["ok"]);
    if (explicitOk !== undefined) return explicitOk;
    const status = readString(body, ["status"]);
    if (status !== undefined) return status === "ok";
    return undefined;
};

export const getAgentHealth = async ({
    baseUrl,
    headers,
    signal
}: BaseRequest): Promise<AgentHealthResponse> => {
    checkAlreadyAborted(signal);
    const started = Date.now();
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/health/ai?probe=true`,
            {
                headers: buildHeaders(headers),
                method: "GET",
                signal
            }
        );
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapAgentErrorResponse(response);
    }
    const json = await response.json();
    const body = isRecord(json) ? json : {};
    const latencyMs = Date.now() - started;
    const legacyOk = inferOkFromBody(body);
    const ready = readBoolean(body, ["ready"]) ?? legacyOk ?? false;
    const realProviderReady =
        readBoolean(body, ["realProviderReady", "real_provider_ready"]) ??
        legacyOk ??
        ready;
    const stubMode = readBoolean(body, ["stubMode", "stub_mode"]) ?? false;
    const providerConnectivity = readProviderConnectivity(body);
    return {
        ok: ready && realProviderReady,
        agentsLoaded: readNumber(body, ["agentsLoaded", "agents_loaded"]) ?? 0,
        latencyMs: readNumber(body, ["latencyMs"]) ?? latencyMs,
        ready,
        realProviderReady,
        provider:
            readString(body, [
                "providerResolved",
                "provider_resolved",
                "provider"
            ]) ?? null,
        model: readString(body, ["model"]) ?? null,
        stubMode,
        issues: readStringArray(body, ["issues"]),
        warnings: readStringArray(body, ["warnings"]),
        ...(providerConnectivity ? { providerConnectivity } : {})
    };
};
