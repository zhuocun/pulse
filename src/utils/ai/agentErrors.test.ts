import {
    AgentAuthError,
    AgentBudgetError,
    AgentForbiddenError,
    AgentNotFoundError,
    AgentRateLimitError,
    AgentServerError,
    AgentTransportError
} from "./agentErrors";

describe("agent error classes", () => {
    it("AgentTransportError carries name, optional cause and code", () => {
        const inner = new Error("boom");
        const err = new AgentTransportError("transport failed", inner, "EX1");
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("AgentTransportError");
        expect(err.message).toBe("transport failed");
        expect(err.cause).toBe(inner);
        expect(err.code).toBe("EX1");
    });

    it("AgentAuthError defaults to a stable user-visible message", () => {
        const err = new AgentAuthError();
        expect(err.name).toBe("AgentAuthError");
        expect(err.message).toBe("Agent server rejected the auth token");
        // Overrideable.
        expect(new AgentAuthError("session expired").message).toBe(
            "session expired"
        );
    });

    it("AgentForbiddenError exposes optional structured code", () => {
        const err = new AgentForbiddenError("nope", "AUTONOMY_BLOCKED");
        expect(err.name).toBe("AgentForbiddenError");
        expect(err.message).toBe("nope");
        expect(err.code).toBe("AUTONOMY_BLOCKED");
        // Default-constructed: no code.
        expect(new AgentForbiddenError().code).toBeUndefined();
    });

    it("AgentRateLimitError surfaces retryAfterSeconds and a default message", () => {
        const err = new AgentRateLimitError(15);
        expect(err.name).toBe("AgentRateLimitError");
        expect(err.retryAfterSeconds).toBe(15);
        expect(err.message).toContain("15s");
        // Custom override:
        expect(new AgentRateLimitError(5, "slow down").message).toBe(
            "slow down"
        );
    });

    it("AgentBudgetError defaults and accepts a code", () => {
        const err = new AgentBudgetError("over limit", "BUDGET_EXHAUSTED");
        expect(err.name).toBe("AgentBudgetError");
        expect(err.message).toBe("over limit");
        expect(err.code).toBe("BUDGET_EXHAUSTED");
    });

    it("AgentNotFoundError uses a stable default name and message", () => {
        const err = new AgentNotFoundError();
        expect(err.name).toBe("AgentNotFoundError");
        expect(err.message).toBe("Agent not found");
    });

    it("AgentServerError surfaces status and default message", () => {
        const err = new AgentServerError(502);
        expect(err.name).toBe("AgentServerError");
        expect(err.status).toBe(502);
        expect(err.message).toBe("Agent server error (502)");
        // Custom message override:
        expect(new AgentServerError(500, "kaboom").message).toBe("kaboom");
    });

    it("each error is structurally distinguishable by `name`", () => {
        const names = new Set([
            new AgentTransportError("a").name,
            new AgentAuthError().name,
            new AgentForbiddenError().name,
            new AgentRateLimitError(1).name,
            new AgentBudgetError().name,
            new AgentNotFoundError().name,
            new AgentServerError(500).name
        ]);
        expect(names.size).toBe(7);
    });
});
