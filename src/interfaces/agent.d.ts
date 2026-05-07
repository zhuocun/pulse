/**
 * Wire types for the LangGraph v2 streaming agent endpoint
 * (`POST /api/v1/agents/{name}/stream`). The backend serves a Server-Sent
 * Events stream where each event payload is one of these `StreamPart`s; the
 * client (see `src/utils/ai/agentClient.ts`) parses them into a typed async
 * iterable and the `useAgent` hook reduces them into UI state.
 *
 * These types are intentionally `.d.ts`-style (no runtime emit) so they can
 * be referenced both from FE code and from agent-server contract docs.
 */

export type AutonomyLevel = "suggest" | "plan" | "auto";

export interface AgentMetadata {
    name: string;
    version: string;
    description: string;
    status: "active" | "deprecated" | "shadow";
    allowed_autonomy: AutonomyLevel[];
    tools?: string[];
    rate_limit?: { per_minute: number; per_hour: number };
}

export interface AgentListResponse {
    agents: AgentMetadata[];
}

export interface CitationRef {
    source: "task" | "column" | "member" | "project";
    id: string;
    quote: string;
}

/**
 * Field-scoped task mutation. `field` is the union of editable task
 * properties (PRD v2 §5.4.2). `from` / `to` carry the prior and proposed
 * value — typed `unknown` because the field varies per row, but kept in
 * a single shape so renderers can do `from`-vs-`to` diffing uniformly.
 */
export interface TaskUpdate {
    task_id: string;
    field:
        | "coordinatorId"
        | "columnId"
        | "epic"
        | "type"
        | "storyPoints"
        | "taskName"
        | "note";
    from: unknown;
    to: unknown;
}

export interface ColumnUpdate {
    column_id: string;
    field: "name" | "order";
    from: unknown;
    to: unknown;
}

/**
 * Bulk operation against a homogeneous set of `targets`. Used for
 * "reassign all unowned bugs to Alice" / "move overdue tasks to Doing"
 * patterns — the agent picks the operation name (e.g. `assign`,
 * `set_column`), the FE maps it to a real BE call.
 */
export interface BulkApply {
    operation: string;
    targets: string[];
    payload: Record<string, unknown>;
}

export interface MutationDiff {
    task_updates?: TaskUpdate[];
    column_updates?: ColumnUpdate[];
    bulk_apply?: BulkApply[];
}

export interface MutationProposal {
    proposal_id: string;
    description: string;
    diff: MutationDiff;
    risk: "low" | "med" | "high";
    undoable: true;
}

export interface TriageNudge {
    nudge_id: string;
    kind: "load_imbalance" | "wip_overflow" | "unowned_bug" | "stale_task";
    project_id: string;
    summary: string;
    target_ids: string[];
    severity: "info" | "warn" | "critical";
}

export type CustomEvent =
    | { kind: "citation"; refs: CitationRef[] }
    | { kind: "mutation_proposal"; proposal: MutationProposal }
    | {
          kind: "suggestion";
          surface: "brief" | "draft" | "estimate" | "readiness" | "search";
          payload: unknown;
      }
    | { kind: "usage"; tokensIn: number; tokensOut: number }
    | { kind: "nudge"; nudge: TriageNudge };

export interface InterruptPayload {
    tool: string;
    args: Record<string, unknown>;
}

export interface LLMTokenChunk {
    content: string;
    type?: string;
}

export interface MessageMetadata {
    langgraph_node?: string;
    [key: string]: unknown;
}

export type StreamPart =
    | { type: "updates"; ns: string[]; data: Record<string, unknown> }
    | { type: "messages"; ns: string[]; data: [LLMTokenChunk, MessageMetadata] }
    | { type: "custom"; ns: string[]; data: CustomEvent }
    | { type: "interrupt"; ns: string[]; data: InterruptPayload }
    | {
          type: "error";
          ns: string[];
          data: { message: string; recoverable?: boolean };
      };

export interface AgentStreamRequest {
    input: {
        messages?: Array<{ role: string; content: string }>;
        [k: string]: unknown;
    } | null;
    command?: { resume: unknown };
    config: {
        configurable: {
            thread_id: string;
            // NOTE: `user_id` is deliberately absent from this shape. The
            // agent server derives the caller's identity from the JWT in
            // `Authorization` and rejects any `user_id` in `configurable`
            // with HTTP 400 to prevent spoofing (see
            // `backend/app/routers/agents.py::_normalize_payload`). The trailing
            // index signature is kept so callers can still pass other
            // graph-scoped knobs (e.g. `project_id`, `autonomy`).
            [k: string]: unknown;
        };
    };
    /**
     * Modes to request from the LangGraph v2 streaming endpoint.
     * Note: interrupt events arrive out-of-band from LangGraph's HITL
     * mechanism and do not need to be requested via stream_mode. They are
     * handled by the client (see `useAgent.ts`) separately from the
     * stream_mode subscription.
     */
    stream_mode: Array<"updates" | "messages" | "custom">;
    version: "v2";
}

export interface AgentHealthResponse {
    ok: boolean;
    agentsLoaded: number;
    latencyMs: number;
}
