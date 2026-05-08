/**
 * Shared HTTP-status → typed-error mapper (PRD v3 §9.2 X-R5).
 *
 * Both the v1 AI routes (`useAi`, `useAiChat`) and the v2 agent client
 * (`agentClient`) must convert non-OK responses to the same typed Error
 * subclasses so the single `aiErrorView` handler can present consistent
 * UI regardless of which surface triggered the request.
 *
 * Previously the v1 surfaces collapsed everything into a plain
 * `Error("AI request failed (NNN)")`, so only the agent client enjoyed
 * typed errors. This module extracts the canonical mapping so both
 * surfaces share it.
 */
import {
    AgentAuthError,
    AgentBudgetError,
    AgentForbiddenError,
    AgentNotFoundError,
    AgentRateLimitError,
    AgentServerError,
    AgentTransportError
} from "./agentErrors";

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

type ErrorSurface = "ai" | "agent";

const transportFallback = (surface: ErrorSurface, status: number) =>
    surface === "ai"
        ? `AI request failed (${status})`
        : `Agent request failed (${status})`;

/**
 * Convert a non-OK `Response` into the appropriate typed Error subclass.
 * Body parsing is best-effort: if the server returns JSON we surface its
 * `message`, but we never throw a secondary error from inside this helper.
 */
const mapErrorResponseForSurface = async (
    response: Response,
    surface: ErrorSurface
): Promise<Error> => {
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
            ? (((body as { message?: unknown; error?: unknown }).message ??
                  (body as { message?: unknown; error?: unknown }).error) as
                  | string
                  | undefined)
            : typeof body === "string"
              ? body
              : undefined;
    const codeFromBody: string | undefined =
        typeof body === "object" && body !== null
            ? ((body as { code?: unknown }).code as string | undefined)
            : undefined;

    const status = response.status;
    if (status === 401) {
        return new AgentAuthError(messageFromBody);
    }
    if (status === 402) {
        return new AgentBudgetError(messageFromBody, codeFromBody);
    }
    if (status === 403) {
        return new AgentForbiddenError(messageFromBody, codeFromBody);
    }
    if (status === 404) {
        return new AgentNotFoundError(messageFromBody);
    }
    if (status === 429) {
        if (safeReadBudgetReason(response)) {
            return new AgentBudgetError(messageFromBody);
        }
        const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
        return new AgentRateLimitError(retryAfter, messageFromBody);
    }
    if (status >= 500) {
        return new AgentServerError(status, messageFromBody);
    }
    return new AgentTransportError(
        messageFromBody ?? transportFallback(surface, status)
    );
};

/** v1 AI JSON routes (`useAi`, `useAiChat`). */
export const mapErrorResponse = (response: Response) =>
    mapErrorResponseForSurface(response, "ai");

/** v2 agent HTTP client (`agentClient`). */
export const mapAgentErrorResponse = (response: Response) =>
    mapErrorResponseForSurface(response, "agent");
