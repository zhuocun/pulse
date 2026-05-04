import type {
    AgentHealthResponse,
    AgentListResponse,
    AgentMetadata,
    AgentStreamRequest,
    StreamPart
} from "../../interfaces/agent";
import { getStoredBearerAuthHeader } from "../aiAuthHeader";
import { newIdempotencyKey } from "./idempotencyKey";

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

export class AgentTransportError extends Error {
    constructor(
        message: string,
        public cause?: unknown
    ) {
        super(message);
        this.name = "AgentTransportError";
    }
}

export class AgentAuthError extends Error {
    constructor(message = "Agent server rejected the auth token") {
        super(message);
        this.name = "AgentAuthError";
    }
}

/**
 * Distinguishes 403 from 401: the request was authenticated but the
 * caller does not have permission for this agent / autonomy level / org.
 * Splitting the error class lets the UI route 403 to a "request access"
 * flow instead of nudging the user back to login (which is what 401
 * triggers).
 */
export class AgentForbiddenError extends Error {
    constructor(message = "Agent server forbade this request") {
        super(message);
        this.name = "AgentForbiddenError";
    }
}

export class AgentRateLimitError extends Error {
    constructor(
        public retryAfterSeconds: number,
        message?: string
    ) {
        super(
            message ??
                `Agent server rate-limited (retry in ${retryAfterSeconds}s)`
        );
        this.name = "AgentRateLimitError";
    }
}

export class AgentBudgetError extends Error {
    constructor(message = "Agent budget exhausted for this user/project") {
        super(message);
        this.name = "AgentBudgetError";
    }
}

export class AgentNotFoundError extends Error {
    constructor(message = "Agent not found") {
        super(message);
        this.name = "AgentNotFoundError";
    }
}

export class AgentServerError extends Error {
    constructor(
        public status: number,
        message?: string
    ) {
        super(message ?? `Agent server error (${status})`);
        this.name = "AgentServerError";
    }
}

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
    extra?: Record<string, string>
): Record<string, string> => {
    const auth = getStoredBearerAuthHeader();
    const base: Record<string, string> = {
        "Content-Type": "application/json"
    };
    if (auth) base.Authorization = auth;
    return { ...base, ...(extra ?? {}) };
};

const parseRetryAfter = (raw: string | null): number => {
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds);
    return 0;
};

const safeReadBudgetReason = (response: Response): boolean => {
    const reason = response.headers.get("X-Reason") ?? "";
    return reason.toLowerCase() === "budget";
};

/**
 * Convert a non-OK Response into the appropriate typed error. Body parsing
 * is best-effort: if the server returns JSON we surface its `message`, but
 * we never throw a different error from inside this branch.
 */
const mapErrorResponse = async (response: Response): Promise<Error> => {
    let body: unknown = null;
    try {
        const text = await response.text();
        if (text.trim()) {
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
        }
    } catch {
        body = null;
    }
    const messageFromBody =
        typeof body === "object" && body !== null
            ? ((body as { message?: unknown }).message as string | undefined)
            : typeof body === "string"
              ? body
              : undefined;

    const status = response.status;
    if (status === 401) {
        return new AgentAuthError(messageFromBody);
    }
    if (status === 403) {
        return new AgentForbiddenError(messageFromBody);
    }
    if (status === 402) {
        return new AgentBudgetError(messageFromBody);
    }
    if (status === 429) {
        if (safeReadBudgetReason(response)) {
            return new AgentBudgetError(messageFromBody);
        }
        const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
        return new AgentRateLimitError(retryAfter, messageFromBody);
    }
    if (status === 404) {
        return new AgentNotFoundError(messageFromBody);
    }
    if (status >= 500) {
        return new AgentServerError(status, messageFromBody);
    }
    return new AgentTransportError(
        messageFromBody ?? `Agent request failed (${status})`
    );
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
    if (!payload || payload === "[DONE]") return null;
    try {
        return JSON.parse(payload) as StreamPart;
    } catch {
        return null;
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
    const idempotencyKey = newIdempotencyKey();
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/agents/${encodeURIComponent(name)}/stream`,
            {
                body: JSON.stringify(body),
                headers: buildHeaders({
                    Accept: "text/event-stream",
                    "Idempotency-Key": idempotencyKey,
                    ...(headers ?? {})
                }),
                method: "POST",
                signal
            }
        );
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapErrorResponse(response);
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
    const idempotencyKey = newIdempotencyKey();
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/agents/${encodeURIComponent(name)}/invoke`,
            {
                body: JSON.stringify(body),
                headers: buildHeaders({
                    "Idempotency-Key": idempotencyKey,
                    ...(headers ?? {})
                }),
                method: "POST",
                signal
            }
        );
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapErrorResponse(response);
    }
    return (await response.json()) as T;
};

export const listAgents = async ({
    baseUrl,
    headers,
    signal
}: BaseRequest): Promise<AgentListResponse> => {
    checkAlreadyAborted(signal);
    let response: Response;
    try {
        response = await fetch(`${trimSlash(baseUrl)}/api/v1/agents`, {
            headers: buildHeaders(headers),
            method: "GET",
            signal
        });
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapErrorResponse(response);
    }
    return (await response.json()) as AgentListResponse;
};

export const getAgentMetadata = async ({
    name,
    baseUrl,
    headers,
    signal
}: AgentByNameRequest): Promise<AgentMetadata> => {
    checkAlreadyAborted(signal);
    let response: Response;
    try {
        response = await fetch(
            `${trimSlash(baseUrl)}/api/v1/agents/${encodeURIComponent(name)}`,
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
        throw await mapErrorResponse(response);
    }
    return (await response.json()) as AgentMetadata;
};

/**
 * Server health body shape on the wire (`/api/v1/health`). Both
 * snake_case fields (`status`, `agents_loaded`) and camelCase fields
 * (`ok`, `agentsLoaded`) are accepted because the Python server emits
 * both for backwards compatibility. We map either into the canonical
 * `AgentHealthResponse` so the rest of the app stays oblivious.
 */
interface RawAgentHealthResponse {
    status?: string;
    ok?: boolean;
    agents_loaded?: number;
    agentsLoaded?: number;
    latencyMs?: number;
}

/**
 * Coerce the server-side health flag. Returns `undefined` (not `false`)
 * when the body has no opinion so the caller can fall back to the HTTP
 * status. A naive `body.ok ?? body.status === "ok" ?? response.ok`
 * collapses by precedence into `?? false ?? response.ok` and the third
 * branch is unreachable.
 */
const inferOkFromBody = (body: RawAgentHealthResponse): boolean | undefined => {
    if (typeof body.ok === "boolean") return body.ok;
    if (typeof body.status === "string") return body.status === "ok";
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
        response = await fetch(`${trimSlash(baseUrl)}/api/v1/health`, {
            headers: buildHeaders(headers),
            method: "GET",
            signal
        });
    } catch (err) {
        throw wrapNetworkError(err);
    }
    if (!response.ok) {
        throw await mapErrorResponse(response);
    }
    const json = (await response.json()) as RawAgentHealthResponse;
    const latencyMs = Date.now() - started;
    return {
        ok: inferOkFromBody(json) ?? response.ok,
        agentsLoaded: json.agentsLoaded ?? json.agents_loaded ?? 0,
        latencyMs: json.latencyMs ?? latencyMs
    };
};
