import type { QueryClient } from "@tanstack/react-query";

import type { AutonomyLevel } from "../../../interfaces/agent";

/**
 * Context passed to every FE tool implementation. Tools read from the React
 * Query cache (via `queryClient.getQueryData`) and receive the optional
 * `projectId` / `userId` so they can scope or filter the result. Additional
 * keys are allowed so callers can plug in viewport selection state, focus
 * info, draft buffers, etc., without us reshaping the registry contract.
 *
 * `autonomyLevel` lets read-side tools redact sensitive content at the
 * lowest autonomy ("suggest" — agent gives advice, no actions) while
 * passing the full payload at higher autonomy ("plan" / "auto" —
 * the agent is already trusted to manipulate the board). See PRD v2 §5.6
 * and `boardSnapshot.ts` for the redaction policy.
 */
export interface FeToolContext {
    queryClient: QueryClient;
    projectId?: string;
    userId?: string;
    autonomyLevel?: AutonomyLevel;
    /**
     * Authenticated REST helper (from `useApi`) for mutation tools that
     * must reach `/api/v1/*` during an agent interrupt.
     */
    apiRequest?: (
        endpoint: string,
        config?: { method?: string; data?: object }
    ) => Promise<unknown>;
    [key: string]: unknown;
}

export interface FeTool<Args = unknown, Result = unknown> {
    name: string;
    description: string;
    run: (args: Args, ctx: FeToolContext) => Promise<Result> | Result;
}
