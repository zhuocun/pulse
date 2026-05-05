import {
    AgentAuthError,
    AgentBudgetError,
    AgentForbiddenError,
    AgentNotFoundError,
    AgentRateLimitError,
    AgentServerError,
    AgentTransportError
} from "./agentErrors";
import { aiErrorView } from "./errorTemplate";

describe("aiErrorView", () => {
    it("returns the default template for plain Errors", () => {
        const view = aiErrorView(new Error("boom"));
        expect(view.heading).toMatch(/error/i);
        expect(view.retryable).toBe(true);
    });

    it("uses the surface-specific fallback heading", () => {
        const view = aiErrorView(new Error("boom"), "Couldn't generate brief");
        expect(view.heading).toBe("Couldn't generate brief");
    });

    it("explains rate limits with a wait", () => {
        const err = new AgentRateLimitError(45, "rate limited");
        const view = aiErrorView(err);
        expect(view.heading).toBe("Board Copilot is at capacity");
        expect(view.body).toContain("45");
        expect(view.retryable).toBe(false);
        expect(view.severity).toBe("info");
    });

    it("exposes disabledForSeconds on rate limit errors", () => {
        const err = new AgentRateLimitError(60);
        const view = aiErrorView(err);
        expect(view.disabledForSeconds).toBe(60);
    });

    it("clamps retryAfterSeconds to at least 1", () => {
        const err = new AgentRateLimitError(0);
        const view = aiErrorView(err);
        expect(view.disabledForSeconds).toBe(1);
    });

    it("prompts re-auth for AgentAuthError", () => {
        const view = aiErrorView(new AgentAuthError());
        expect(view.heading).toBe("You're signed out");
        expect(view.retryable).toBe(false);
    });

    it("uses transport heading for AgentTransportError", () => {
        const view = aiErrorView(new AgentTransportError("fetch failed"));
        expect(view.heading).toContain("couldn't reach");
        expect(view.retryable).toBe(true);
    });

    it("treats abort as a passive 'Stopped' state, not a failure", () => {
        const abortError = new DOMException("aborted", "AbortError");
        const view = aiErrorView(abortError);
        expect(view.heading).toBe("Stopped");
        expect(view.severity).toBe("info");
    });

    it("never surfaces raw error.message text", () => {
        const view = aiErrorView(new Error("HTTP 500: NullPointerException"));
        expect(view.heading).not.toContain("500");
        expect(view.body).not.toContain("Null");
    });

    it("maps AgentBudgetError to non-retryable budget message", () => {
        const view = aiErrorView(new AgentBudgetError());
        expect(view.retryable).toBe(false);
        expect(view.heading).toMatch(/credits|budget|AI/i);
        expect(view.body.length).toBeGreaterThan(0);
    });

    it("maps AgentForbiddenError to non-retryable permission denied", () => {
        const view = aiErrorView(new AgentForbiddenError());
        expect(view.retryable).toBe(false);
        expect(view.heading).toMatch(/permission|denied/i);
        expect(view.body.length).toBeGreaterThan(0);
    });

    it("maps AgentNotFoundError to non-retryable agent unavailable", () => {
        const view = aiErrorView(new AgentNotFoundError());
        expect(view.retryable).toBe(false);
        expect(view.heading).toMatch(/unavailable|agent/i);
        expect(view.body.length).toBeGreaterThan(0);
    });

    it("maps AgentServerError to retryable server trouble", () => {
        const view = aiErrorView(new AgentServerError(503));
        expect(view.retryable).toBe(true);
        expect(view.heading).toMatch(/trouble|service/i);
        expect(view.body.length).toBeGreaterThan(0);
    });

    it("returns null-safe default when error is null", () => {
        const view = aiErrorView(null);
        expect(view.heading).toBeTruthy();
        expect(view.retryable).toBe(true);
    });

    it("returns null-safe default when error is undefined", () => {
        const view = aiErrorView(undefined);
        expect(view.heading).toBeTruthy();
        expect(view.retryable).toBe(true);
    });

    it("fallback heading overrides for AgentTransportError", () => {
        const view = aiErrorView(
            new AgentTransportError("net"),
            "Custom surface heading"
        );
        expect(view.heading).toBe("Custom surface heading");
    });
});
