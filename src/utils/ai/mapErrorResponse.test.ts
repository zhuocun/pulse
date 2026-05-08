/**
 * Unit tests for mapErrorResponse / mapAgentErrorResponse.
 *
 * Key contracts:
 *   1. Correct typed-error class per HTTP status.
 *   2. 403 with a structured `{"code", "message"}` body threads `code` into
 *      AgentForbiddenError (server envelope introduced in v2.1 session).
 *   3. 402 with a structured body threads `code` into AgentBudgetError.
 *   4. Legacy plain-string body still works (backwards compat).
 *   5. Missing / malformed body falls back gracefully.
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
import { mapAgentErrorResponse, mapErrorResponse } from "./mapErrorResponse";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeHeaders = (entries: Record<string, string> = {}) => {
    const map = new Map<string, string>(
        Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v])
    );
    return {
        get: (name: string) => map.get(name.toLowerCase()) ?? null,
        has: (name: string) => map.has(name.toLowerCase())
    };
};

const fakeResponse = (
    status: number,
    body: unknown = null,
    extraHeaders: Record<string, string> = {}
): Response => {
    const text =
        body === null
            ? ""
            : typeof body === "string"
              ? body
              : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        text: jest.fn().mockResolvedValue(text),
        headers: makeHeaders(extraHeaders)
    } as unknown as Response;
};

// ---------------------------------------------------------------------------
// mapErrorResponse (v1 AI surface)
// ---------------------------------------------------------------------------

describe("mapErrorResponse", () => {
    it("maps 401 to AgentAuthError", async () => {
        const err = await mapErrorResponse(fakeResponse(401));
        expect(err).toBeInstanceOf(AgentAuthError);
    });

    it("maps 402 to AgentBudgetError", async () => {
        const err = await mapErrorResponse(fakeResponse(402));
        expect(err).toBeInstanceOf(AgentBudgetError);
    });

    it("maps 403 to AgentForbiddenError", async () => {
        const err = await mapErrorResponse(fakeResponse(403));
        expect(err).toBeInstanceOf(AgentForbiddenError);
    });

    it("maps 404 to AgentNotFoundError", async () => {
        const err = await mapErrorResponse(fakeResponse(404));
        expect(err).toBeInstanceOf(AgentNotFoundError);
    });

    it("maps 429 to AgentRateLimitError and reads Retry-After", async () => {
        const err = await mapErrorResponse(
            fakeResponse(429, null, { "Retry-After": "10" })
        );
        expect(err).toBeInstanceOf(AgentRateLimitError);
        expect((err as AgentRateLimitError).retryAfterSeconds).toBe(10);
    });

    it("maps 429 with X-Reason: budget to AgentBudgetError", async () => {
        const err = await mapErrorResponse(
            fakeResponse(429, null, { "X-Reason": "budget" })
        );
        expect(err).toBeInstanceOf(AgentBudgetError);
    });

    it("maps 500 to AgentServerError with correct status", async () => {
        const err = await mapErrorResponse(fakeResponse(503));
        expect(err).toBeInstanceOf(AgentServerError);
        expect((err as AgentServerError).status).toBe(503);
    });

    it("maps unexpected 4xx to AgentTransportError", async () => {
        const err = await mapErrorResponse(fakeResponse(418));
        expect(err).toBeInstanceOf(AgentTransportError);
    });

    // ------------------------------------------------------------------
    // Fix 1: structured {code, message} envelope for 403
    // ------------------------------------------------------------------

    it("403 with {code, message} envelope: carries code on AgentForbiddenError", async () => {
        const err = await mapErrorResponse(
            fakeResponse(403, {
                code: "forbidden",
                message: "AI is disabled for this project"
            })
        );
        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBe("forbidden");
        expect(err.message).toBe("AI is disabled for this project");
    });

    it("403 with legacy plain-string body: code is undefined (back-compat)", async () => {
        const err = await mapErrorResponse(fakeResponse(403, "Access denied"));
        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBeUndefined();
        expect(err.message).toBe("Access denied");
    });

    it("403 with JSON body missing code: code is undefined", async () => {
        const err = await mapErrorResponse(
            fakeResponse(403, { message: "no code here" })
        );
        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBeUndefined();
        expect(err.message).toBe("no code here");
    });

    it("falls back to JSON body.error when message is absent", async () => {
        const err = await mapErrorResponse(
            fakeResponse(403, {
                code: "forbidden",
                error: "Project AI access is disabled"
            })
        );

        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBe("forbidden");
        expect(err.message).toBe("Project AI access is disabled");
    });

    it("403 with empty body: falls back to default message, code undefined", async () => {
        const err = await mapErrorResponse(fakeResponse(403, null));
        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBeUndefined();
        expect(err.message).toBe("Agent server forbade this request");
    });

    it("403 with malformed JSON body: falls back gracefully", async () => {
        // body is a raw non-JSON string that is not empty
        const err = await mapErrorResponse(fakeResponse(403, "not-json{{"));
        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBeUndefined();
    });

    // ------------------------------------------------------------------
    // Fix 1: structured {code, message} envelope for 402
    // ------------------------------------------------------------------

    it("402 with {code, message} envelope: carries code on AgentBudgetError", async () => {
        const err = await mapErrorResponse(
            fakeResponse(402, {
                code: "quota_exceeded",
                message: "Monthly token quota exhausted"
            })
        );
        expect(err).toBeInstanceOf(AgentBudgetError);
        expect((err as AgentBudgetError).code).toBe("quota_exceeded");
        expect(err.message).toBe("Monthly token quota exhausted");
    });

    it("402 with legacy plain-string body: code is undefined (back-compat)", async () => {
        const err = await mapErrorResponse(
            fakeResponse(402, "payment required")
        );
        expect(err).toBeInstanceOf(AgentBudgetError);
        expect((err as AgentBudgetError).code).toBeUndefined();
        expect(err.message).toBe("payment required");
    });
});

// ---------------------------------------------------------------------------
// mapAgentErrorResponse (v2 agent surface) — verify same routing
// ---------------------------------------------------------------------------

describe("mapAgentErrorResponse", () => {
    it("maps 403 with {code, message} to AgentForbiddenError carrying code", async () => {
        const err = await mapAgentErrorResponse(
            fakeResponse(403, {
                code: "forbidden",
                message: "AI is disabled for this project"
            })
        );
        expect(err).toBeInstanceOf(AgentForbiddenError);
        expect((err as AgentForbiddenError).code).toBe("forbidden");
    });

    it("maps 401 to AgentAuthError", async () => {
        const err = await mapAgentErrorResponse(fakeResponse(401));
        expect(err).toBeInstanceOf(AgentAuthError);
    });
});
