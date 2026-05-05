/**
 * Typed errors for AI v1 routes and the v2 agent HTTP client. Lives in a
 * dedicated module so `mapErrorResponse` can import these classes without
 * creating a circular dependency with `agentClient.ts`.
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
