import { useCallback, useEffect, useRef, useState } from "react";

import environment from "../../constants/env";
import { getStoredBearerAuthHeader } from "../aiAuthHeader";
import { parseFetchBody } from "../parseFetchBody";
import { rewriteNetworkFetchError } from "../networkFetchError";

import { sanitizeRemotePayloadForRoute } from "../ai/aiDataScope";
import { newIdempotencyKey } from "../ai/idempotencyKey";
import { mapErrorResponse } from "../ai/mapErrorResponse";
import {
    AiContextProject,
    AiSearchProjectsContext,
    boardBrief,
    breakdownTask,
    DraftRequest,
    draftTask,
    estimate,
    EstimateRequest,
    readiness,
    ReadinessRequest,
    semanticSearch
} from "../ai/engine";
import {
    validateBoardBrief,
    validateBreakdown,
    validateDraft,
    validateEstimate,
    validateReadiness,
    validateSearch
} from "../ai/validate";
import {
    isProjectAiDisabled,
    PROJECT_AI_DISABLED_MESSAGE
} from "../ai/projectAiStorage";

/**
 * Throws if a board-scoped payload targets a project the user has opted out
 * of via per-project disable (PRD §8). The projects-list semantic search is
 * intentionally not blocked here: a single disabled project must not break a
 * global search; callers should filter the projects context themselves.
 */
export const assertRunPayloadProjectsAiAllowed = (payload: RunPayload) => {
    const blocked: string[] = [];
    if (payload.draft?.context.project._id) {
        blocked.push(payload.draft.context.project._id);
    }
    if (payload.estimate?.context.project._id) {
        blocked.push(payload.estimate.context.project._id);
    }
    if (payload.readiness?.context.project._id) {
        blocked.push(payload.readiness.context.project._id);
    }
    if (payload.brief?.context.project._id) {
        blocked.push(payload.brief.context.project._id);
    }
    if (payload.search?.kind === "tasks" && payload.search.projectContext) {
        blocked.push(payload.search.projectContext.project._id);
    }
    for (const id of blocked) {
        if (isProjectAiDisabled(id)) {
            throw new Error(PROJECT_AI_DISABLED_MESSAGE);
        }
    }
};

export type AiRoute =
    | "task-draft"
    | "task-breakdown"
    | "estimate"
    | "readiness"
    | "board-brief"
    | "search";

interface UseAiOptions {
    route: AiRoute;
}

export interface RunPayload {
    draft?: DraftRequest & { count?: number };
    estimate?: EstimateRequest & { context: AiContextProject };
    readiness?: ReadinessRequest & { context: AiContextProject };
    brief?: { context: AiContextProject };
    search?: {
        kind: "tasks" | "projects";
        query: string;
        projectContext?: AiContextProject;
        projectsContext?: AiSearchProjectsContext;
    };
}

export const localResolve = (route: AiRoute, payload: RunPayload): unknown => {
    switch (route) {
        case "task-draft": {
            if (!payload.draft) throw new Error("draft payload required");
            return draftTask(payload.draft);
        }
        case "task-breakdown": {
            if (!payload.draft) throw new Error("draft payload required");
            return breakdownTask(payload.draft, payload.draft.count ?? 3);
        }
        case "estimate": {
            if (!payload.estimate) throw new Error("estimate payload required");
            return estimate(payload.estimate);
        }
        case "readiness": {
            if (!payload.readiness)
                throw new Error("readiness payload required");
            return readiness(payload.readiness);
        }
        case "board-brief": {
            if (!payload.brief) throw new Error("brief payload required");
            return boardBrief(payload.brief.context);
        }
        case "search": {
            if (!payload.search) throw new Error("search payload required");
            const { kind, query, projectContext, projectsContext } =
                payload.search;
            if (kind === "tasks") {
                if (!projectContext)
                    throw new Error("projectContext required for task search");
                return semanticSearch("tasks", query, projectContext);
            }
            if (!projectsContext) {
                throw new Error("projectsContext required for project search");
            }
            return semanticSearch("projects", query, projectsContext);
        }
        default:
            throw new Error(`Unknown AI route: ${route as string}`);
    }
};

export const validateResponse = (
    route: AiRoute,
    raw: unknown,
    payload: RunPayload
): unknown => {
    if (route === "task-draft" && payload.draft) {
        return validateDraft(raw as IDraftTaskSuggestion, {
            columns: payload.draft.context.columns,
            members: payload.draft.context.members,
            tasks: payload.draft.context.tasks,
            fallbackColumnId: payload.draft.columnId,
            fallbackCoordinatorId: payload.draft.coordinatorId
        });
    }
    if (route === "task-breakdown" && payload.draft) {
        return validateBreakdown(raw as ITaskBreakdownSuggestion, {
            columns: payload.draft.context.columns,
            members: payload.draft.context.members,
            tasks: payload.draft.context.tasks,
            fallbackColumnId: payload.draft.columnId,
            fallbackCoordinatorId: payload.draft.coordinatorId
        });
    }
    if (route === "estimate" && payload.estimate) {
        return validateEstimate(raw as IEstimateSuggestion, {
            columns: payload.estimate.context.columns,
            members: payload.estimate.context.members,
            tasks: payload.estimate.context.tasks
        });
    }
    if (route === "board-brief" && payload.brief) {
        return validateBoardBrief(raw as IBoardBrief, {
            columns: payload.brief.context.columns,
            members: payload.brief.context.members,
            tasks: payload.brief.context.tasks
        });
    }
    if (route === "readiness") {
        return validateReadiness(raw as IReadinessReport);
    }
    if (route === "search" && payload.search) {
        const validIds =
            payload.search.kind === "tasks" && payload.search.projectContext
                ? new Set(
                      payload.search.projectContext.tasks.map(
                          (task) => task._id
                      )
                  )
                : new Set(
                      (payload.search.projectsContext?.projects ?? []).map(
                          (project) => project._id
                      )
                  );
        return validateSearch(raw as ISearchResult, validIds);
    }
    return raw;
};

/**
 * Remote v1 AI route. POSTs to `${aiBaseUrl}/api/ai/{route}` -- the
 * Python backend (`backend/`) mounts this prefix as a deterministic-
 * with-LLM-polish shim (see `backend/app/routers/ai.py`) alongside the
 * v2.1 `/api/v1/agents/...` agent surface, and exposes
 * the same routes under `/api/v1/ai/` for new clients. With
 * `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) set on the server, the
 * structured routes (Brief, Draft, Breakdown, Estimate, Readiness)
 * polish their text fields via the catalog `polish_*` helpers; chat
 * forwards to the `chat-agent` runtime; search stays deterministic.
 * When `REACT_APP_AI_BASE_URL` is unset (the default), `run`
 * short-circuits via `environment.aiUseLocalEngine` and the
 * deterministic engine in `utils/ai/engine.ts` answers locally instead.
 */
const remoteResolve = async (
    route: AiRoute,
    payload: RunPayload,
    signal: AbortSignal
): Promise<unknown> => {
    const authHeader = getStoredBearerAuthHeader();
    /*
     * Per-route sanitization. Routes whose `AiDataScope.sendsNotes` is
     * `false` (currently `board-brief`) must not forward task notes to
     * a remote AI proxy even though the engine tolerates the extra field
     * — privacy copy elsewhere relies on this guarantee.
     */
    const sanitized = sanitizeRemotePayloadForRoute(
        route,
        payload as unknown as Record<string, unknown>
    );
    const idempotencyKey = newIdempotencyKey();
    let response: Response;
    try {
        response = await fetch(`${environment.aiBaseUrl}/api/ai/${route}`, {
            body: JSON.stringify(sanitized),
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
                ...(authHeader ? { Authorization: authHeader } : {})
            },
            method: "POST",
            signal
        });
    } catch (err) {
        const rewritten = rewriteNetworkFetchError(err);
        if (rewritten) {
            throw rewritten;
        }
        throw err;
    }
    if (!response.ok) {
        throw await mapErrorResponse(response);
    }
    return parseFetchBody(response);
};

const useAi = <T>(options: UseAiOptions) => {
    const { route } = options;
    const [data, setData] = useState<T | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        // Re-arm `mountedRef` on every mount so React.StrictMode's
        // mount→unmount→remount dev cycle doesn't leave it stuck at `false`.
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    const abort = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
    }, []);

    const reset = useCallback(() => {
        abort();
        setData(undefined);
        setError(null);
        setIsLoading(false);
    }, [abort]);

    const run = useCallback(
        async (payload: RunPayload): Promise<T> => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            setIsLoading(true);
            setError(null);
            try {
                assertRunPayloadProjectsAiAllowed(payload);
                let raw: unknown;
                if (environment.aiUseLocalEngine) {
                    raw = await Promise.resolve(localResolve(route, payload));
                } else {
                    raw = await remoteResolve(
                        route,
                        payload,
                        controller.signal
                    );
                }
                const validated = validateResponse(route, raw, payload) as T;
                if (mountedRef.current && !controller.signal.aborted) {
                    setData(validated);
                }
                return validated;
            } catch (err) {
                const wrapped =
                    err instanceof Error ? err : new Error(String(err));
                if (mountedRef.current && !controller.signal.aborted) {
                    setError(wrapped);
                }
                throw wrapped;
            } finally {
                if (
                    mountedRef.current &&
                    controllerRef.current === controller
                ) {
                    setIsLoading(false);
                    controllerRef.current = null;
                }
            }
        },
        [route, environment.aiUseLocalEngine, environment.aiBaseUrl]
    );

    return {
        run,
        abort,
        reset,
        data,
        error,
        isLoading
    };
};

export default useAi;
