import type { AiRoute } from "../hooks/useAi";

/**
 * Surfaces outside `useAi`'s route union (chat is served by the agent
 * client, ghost text is served by the local engine in `utils/ai/engine`).
 * Listed alongside `AiRoute` here so the privacy popover / one-shot
 * disclosure can present a route-specific scope for every Copilot
 * surface in the app, not just the structured AI routes.
 *
 *   - `chat`      — Board Copilot chat drawer.
 *   - `task-note` — inline ghost-text completions on task-note
 *                   textareas (Wave 3 Ambition 2). Local-engine-only
 *                   at the moment; the scope still lists the fields
 *                   the engine reads so the disclosure copy is
 *                   accurate if the surface ever flips to a remote
 *                   round-trip.
 */
export type AiNonRoute = "chat" | "task-note";

/**
 * Per-route AI data scope (Optimization Plan §3 P0-1).
 *
 * The privacy popover shows users *exactly* which board fields a given AI
 * surface sends to the engine. Each route declares its scope here so the UI
 * copy never drifts from the actual payload — adding a field to a route's
 * payload without updating its scope will trip the unit test in
 * `aiDataScope.test.ts`.
 */
export interface AiDataScope {
    /** Plain-English summary of what this route uses. Shown in the popover. */
    summary: string;
    /** Bullet list rendered under the summary. */
    items: readonly string[];
    /**
     * `true` if this route may send free-text task notes. Surfaces gate the
     * "notes are sent" disclosure on this so we never tell a search user that
     * notes leave the device when, in fact, they do.
     */
    sendsNotes: boolean;
}

const TASK_NOTE_LINE = "Task notes (free-text descriptions)";

/**
 * Static scope table. Routes that share fields keep separate entries so the
 * popover can be precise instead of saying "the same as everywhere else".
 */
export const AI_DATA_SCOPES: Record<AiRoute | AiNonRoute, AiDataScope> = {
    "task-draft": {
        summary: "Drafting a task uses your prompt plus the current board.",
        items: [
            "Your draft prompt and target column",
            "Project name, columns, and member list",
            "Existing task names, types, story points, epics, and column placement",
            TASK_NOTE_LINE
        ],
        sendsNotes: true
    },
    "task-breakdown": {
        summary:
            "Breaking a task into subtasks uses your prompt plus the current board.",
        items: [
            "Your breakdown prompt and chosen axis",
            "Project name, columns, and member list",
            "Existing task names, types, story points, epics, and column placement",
            TASK_NOTE_LINE
        ],
        sendsNotes: true
    },
    estimate: {
        summary:
            "Estimating story points uses the task and similar tasks on this board.",
        items: [
            "The task name, type, epic, and notes",
            "Story points and notes from similar tasks on the board"
        ],
        sendsNotes: true
    },
    readiness: {
        summary:
            "The readiness check uses the current task fields you've entered.",
        items: [
            "The task name, type, epic, coordinator, and notes",
            "Project columns and member list to validate references"
        ],
        sendsNotes: true
    },
    "board-brief": {
        summary:
            "The board brief aggregates board structure — no task notes are sent.",
        items: [
            "Project name, columns, and member usernames",
            "Task names, types, story points, epics, and column placement"
        ],
        sendsNotes: false
    },
    search: {
        summary:
            "Semantic search compares your phrase against task or project text.",
        items: [
            "Your search phrase",
            "Task names, types, epics, and notes (or project names and managers)"
        ],
        sendsNotes: true
    },
    chat: {
        summary:
            "Chat answers use board context plus any record the read-only tools open.",
        items: [
            "Your message and prior turns in this conversation",
            "Project name, columns, members, and task list",
            "Any task you ask Copilot to open by id (including its notes)"
        ],
        sendsNotes: true
    },
    "task-note": {
        /*
         * Phase 4.6 Lane M follow-up (PR #309 review): the ghost-text
         * surface previously fell back to the generic disclosure copy
         * because `task-note` wasn't a known scope key. Surface a
         * dedicated entry that lists only the fields the local
         * `noteCompletion` engine actually reads — the column you're
         * editing in, the task's name + type, and the in-progress
         * text. The engine is local-only today (no remote round-trip),
         * so the scope intentionally omits project / member context
         * that other AI routes need. `sendsNotes: true` because the
         * partially-typed note is itself the input the engine
         * completes from; if the surface ever flips to a remote
         * engine, the existing `sanitizeRemotePayloadForRoute` walker
         * will pick this scope up automatically.
         */
        summary:
            "Ghost-text completions use the task you're editing and your in-progress note.",
        items: [
            "The column you're editing in",
            "The task's name and type (Task or Bug)",
            "The in-progress note text you have typed so far"
        ],
        sendsNotes: true
    }
} as const;

export const getAiDataScope = (route: AiRoute | AiNonRoute): AiDataScope => {
    return AI_DATA_SCOPES[route];
};

/**
 * Strip task notes from a remote payload (Optimization Plan §3 P0-1).
 *
 * Surfaces that don't need notes — currently `board-brief` — must not leak
 * them to a third-party AI proxy even though the backend tolerates the
 * extra field. Returns a structurally-equal payload with `note` removed
 * from each task in the route's context.
 */
type AnyTask = { note?: string; [key: string]: unknown };

const stripTaskNotes = <T extends AnyTask>(tasks: readonly T[]): T[] =>
    tasks.map(({ note: _note, ...rest }) => rest as T);

export const sanitizeRemotePayloadForRoute = <
    P extends Record<string, unknown>
>(
    route: AiRoute | AiNonRoute,
    payload: P
): P => {
    const scope = AI_DATA_SCOPES[route];
    if (scope.sendsNotes) {
        return payload;
    }
    const next = { ...payload } as Record<string, unknown>;
    // Walk known shapes; we only care about `tasks` arrays nested under
    // `context` or directly. Unknown nesting is left untouched so future
    // routes don't silently drop fields without a corresponding update here.
    for (const key of Object.keys(next)) {
        const value = next[key];
        if (!value || typeof value !== "object") continue;
        const block = value as Record<string, unknown>;
        if (Array.isArray(block.tasks)) {
            next[key] = {
                ...block,
                tasks: stripTaskNotes(block.tasks as AnyTask[])
            };
            continue;
        }
        const nestedContext = block.context as
            Record<string, unknown> | undefined;
        if (nestedContext && Array.isArray(nestedContext.tasks)) {
            next[key] = {
                ...block,
                context: {
                    ...nestedContext,
                    tasks: stripTaskNotes(nestedContext.tasks as AnyTask[])
                }
            };
        }
    }
    return next as P;
};
