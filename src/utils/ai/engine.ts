import { jaccard, tokenize, tokenSet } from "./keywords";
import { isOptimisticPlaceholderId } from "../optimisticClientId";
import { clampToFibonacci, FIBONACCI_POINTS } from "./storyPoints";
import { describeExpansions, expandWithSynonyms } from "./synonyms";

export interface AiContextProject {
    project: { _id: string; projectName: string };
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
}

const BUG_HINTS = [
    "bug",
    "fix",
    "broken",
    "crash",
    "error",
    "regression",
    "flaky",
    "leak",
    "issue",
    "incident",
    "outage",
    "failing"
];

const EPIC_HINTS: Array<{ epic: string; hints: string[] }> = [
    { epic: "Bug Fix", hints: BUG_HINTS },
    {
        epic: "Performance",
        hints: ["slow", "perf", "latency", "throughput", "memory", "cache"]
    },
    {
        epic: "Auth",
        hints: ["login", "auth", "token", "session", "password", "signup"]
    },
    {
        epic: "UI Polish",
        hints: [
            "styling",
            "spacing",
            "color",
            "ui",
            "design",
            "layout",
            "modal"
        ]
    },
    {
        epic: "Refactor",
        hints: ["refactor", "cleanup", "rewrite", "migrate", "deprecate"]
    },
    {
        epic: "Documentation",
        hints: ["docs", "documentation", "readme", "guide", "tutorial"]
    },
    {
        epic: "Testing",
        hints: ["test", "tests", "coverage", "spec", "qa", "e2e"]
    }
];

const DEFAULT_EPIC = "New Feature";

const POINT_HINTS: Array<{ regex: RegExp; points: number }> = [
    { regex: /\bquick\b|\btrivial\b|\btypo\b|\b1 ?(?:hr|hour)\b/i, points: 1 },
    { regex: /\bhalf ?day\b|\bsmall\b/i, points: 2 },
    { regex: /\bday\b/i, points: 3 },
    { regex: /\bmedium\b|\b2 ?days\b/i, points: 5 },
    { regex: /\blarge\b|\b3 ?days\b/i, points: 8 },
    { regex: /\bepic\b|\bweek\b|\bhuge\b|\bcomplex\b/i, points: 13 }
];

export const detectType = (text: string): "Task" | "Bug" => {
    const lower = text.toLowerCase();
    return BUG_HINTS.some((hint) => lower.includes(hint)) ? "Bug" : "Task";
};

export const detectEpic = (text: string): string => {
    const lower = text.toLowerCase();
    for (const { epic, hints } of EPIC_HINTS) {
        if (hints.some((hint) => lower.includes(hint))) return epic;
    }
    return DEFAULT_EPIC;
};

const taskNameFromPrompt = (prompt: string): string => {
    const cleaned = prompt.trim().replace(/\s+/g, " ");
    if (cleaned.length === 0) return "Untitled task";
    const firstSentence = cleaned.split(/[.!?\n]/)[0] || cleaned;
    const limit = 80;
    if (firstSentence.length <= limit) {
        const noTrailing = firstSentence.replace(/[,;:]+$/, "");
        return noTrailing.charAt(0).toUpperCase() + noTrailing.slice(1);
    }
    const truncated = firstSentence.slice(0, limit).replace(/\s+\S*$/, "");
    return `${truncated.charAt(0).toUpperCase()}${truncated.slice(1)}…`;
};

const pickColumnForType = (
    columns: IColumn[],
    type: "Task" | "Bug",
    fallbackId?: string
): string => {
    if (columns.length === 0) return fallbackId ?? "";
    const sorted = [...columns].sort((a, b) => a.index - b.index);
    if (type === "Bug") {
        const triage = sorted.find((column) =>
            /triage|inbox|todo|backlog|to ?do/i.test(column.columnName)
        );
        if (triage) return triage._id;
    }
    const backlog = sorted.find((column) =>
        /backlog|to ?do|todo|inbox/i.test(column.columnName)
    );
    if (backlog) return backlog._id;
    if (fallbackId && sorted.some((column) => column._id === fallbackId)) {
        return fallbackId;
    }
    return sorted[0]._id;
};

const inferPointsFromText = (
    text: string
): { points: number; matched: boolean } => {
    for (const hint of POINT_HINTS) {
        if (hint.regex.test(text))
            return { points: hint.points, matched: true };
    }
    const wordCount = tokenize(text).length;
    if (wordCount <= 4) return { points: 2, matched: false };
    if (wordCount <= 12) return { points: 3, matched: false };
    if (wordCount <= 24) return { points: 5, matched: false };
    return { points: 8, matched: false };
};

export interface DraftRequest {
    prompt: string;
    columnId?: string;
    coordinatorId?: string;
    context: AiContextProject;
    /**
     * Optional breakdown axis (PRD v3 D-R3). When the agent supports it
     * the server picks the cut accordingly; the local fallback ignores
     * the value and returns its default split.
     */
    axis?: "by_phase" | "by_surface" | "by_risk" | "freeform";
}

const buildNote = (prompt: string, type: "Task" | "Bug"): string => {
    const intro = prompt.trim();
    const acceptance =
        type === "Bug"
            ? [
                  "Bug is no longer reproducible on the affected surface",
                  "Regression test added for the failure mode",
                  "Root cause documented in the task notes"
              ]
            : [
                  "Behaviour described above is implemented end to end",
                  "Unit and integration tests cover the new behaviour",
                  "User-visible copy is reviewed"
              ];
    const lines = [
        `## Summary`,
        intro,
        ``,
        `## Acceptance criteria`,
        ...acceptance.map((item) => `- ${item}`)
    ];
    return lines.join("\n");
};

export const draftTask = (request: DraftRequest): IDraftTaskSuggestion => {
    const { prompt, columnId, coordinatorId, context } = request;
    const type = detectType(prompt);
    const epic = detectEpic(prompt);
    const taskName = taskNameFromPrompt(prompt);
    const { points, matched } = inferPointsFromText(prompt);
    const storyPoints = clampToFibonacci(points);
    const resolvedColumnId = pickColumnForType(context.columns, type, columnId);
    const resolvedCoordinatorId =
        coordinatorId &&
        context.members.some((member) => member._id === coordinatorId)
            ? coordinatorId
            : (context.members[0]?._id ?? coordinatorId ?? "");
    const confidence = Math.min(
        0.95,
        0.4 +
            (matched ? 0.2 : 0) +
            Math.min(0.3, tokenize(prompt).length * 0.02)
    );
    const note = buildNote(prompt, type);
    return {
        taskName,
        type,
        epic,
        storyPoints,
        note,
        columnId: resolvedColumnId,
        coordinatorId: resolvedCoordinatorId,
        confidence,
        rationale: `Drafted from your prompt as a ${type.toLowerCase()} in epic "${epic}".`
    };
};

const SUBTASK_VERBS = [
    "Investigate",
    "Implement",
    "Add tests for",
    "Document",
    "Polish UX of"
];

export const breakdownTask = (
    request: DraftRequest,
    count = 3
): ITaskBreakdownSuggestion => {
    const base = draftTask(request);
    const items: IDraftTaskSuggestion[] = [];
    const safeCount = Math.max(2, Math.min(6, count));
    for (let index = 0; index < safeCount; index += 1) {
        const verb = SUBTASK_VERBS[index % SUBTASK_VERBS.length];
        const childTaskName =
            `${verb} ${base.taskName.replace(/^([A-Z])/, (match) => match.toLowerCase())}`.slice(
                0,
                100
            );
        items.push({
            ...base,
            taskName: childTaskName,
            storyPoints: clampToFibonacci(
                Math.max(1, Math.round(base.storyPoints / 2))
            ),
            confidence: Math.max(0.3, base.confidence - 0.1),
            rationale: `Sub-step ${index + 1} of ${safeCount}.`
        });
    }
    return { items };
};

export interface EstimateRequest {
    taskName: string;
    note?: string;
    type?: string;
    epic?: string;
    tasks: ITask[];
    excludeTaskId?: string;
}

const summariseTask = (task: ITask): string =>
    `${task.taskName} ${task.note ?? ""} ${task.epic ?? ""}`;

export const estimate = (request: EstimateRequest): IEstimateSuggestion => {
    const focus = `${request.taskName} ${request.note ?? ""} ${
        request.epic ?? ""
    }`;
    const focusTokens = tokenSet(focus);
    const candidates = request.tasks.filter(
        (task) =>
            task._id &&
            !isOptimisticPlaceholderId(task._id) &&
            task._id !== request.excludeTaskId &&
            FIBONACCI_POINTS.includes(task.storyPoints as StoryPoints)
    );
    const scored = candidates
        .map((task) => ({
            task,
            score: jaccard(focusTokens, tokenSet(summariseTask(task)))
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);
    let points: number;
    let confidence: number;
    let rationale: string;
    if (top.length > 0) {
        const totalScore = top.reduce((acc, entry) => acc + entry.score, 0);
        const weighted = top.reduce(
            (acc, entry) => acc + entry.task.storyPoints * entry.score,
            0
        );
        points =
            totalScore > 0 ? weighted / totalScore : top[0].task.storyPoints;
        const averageScore = totalScore / top.length;
        confidence = Math.min(0.92, 0.45 + averageScore);
        rationale = `Based on ${top.length} similar task${
            top.length === 1 ? "" : "s"
        } in this project.`;
    } else {
        const fallback = inferPointsFromText(focus);
        points = fallback.points;
        confidence = fallback.matched ? 0.55 : 0.35;
        rationale = "No similar past tasks found, estimated from text length.";
    }
    return {
        storyPoints: clampToFibonacci(points),
        confidence,
        rationale,
        similar: top.map((entry) => ({
            _id: entry.task._id,
            reason: `Similarity ${(entry.score * 100).toFixed(0)}% with "${entry.task.taskName}"`
        }))
    };
};

export interface ReadinessRequest {
    taskName: string;
    note?: string;
    epic?: string;
    type?: string;
    coordinatorId?: string;
}

export const readiness = (request: ReadinessRequest): IReadinessReport => {
    const issues: IReadinessIssue[] = [];
    if (!request.taskName || request.taskName.trim().length < 3) {
        issues.push({
            field: "taskName",
            severity: "error",
            message: "Task name is too short to be actionable.",
            suggestion:
                'Give it a verb and an object, e.g. "Fix login redirect".'
        });
    }
    const note = request.note ?? "";
    if (note.trim().length === 0) {
        issues.push({
            field: "note",
            severity: "warn",
            message: "No description or acceptance criteria.",
            suggestion: "Add an Acceptance criteria section."
        });
    } else if (!/acceptance|criteria|done when/i.test(note)) {
        issues.push({
            field: "note",
            severity: "info",
            message: "Description has no explicit acceptance criteria.",
            suggestion: 'Add an "Acceptance criteria" section to the note.'
        });
    }
    if (!request.epic || request.epic.trim().length === 0) {
        issues.push({
            field: "epic",
            severity: "info",
            message: "Epic is empty.",
            suggestion: "Pick or invent an epic so the task rolls up."
        });
    }
    if (!request.type || request.type.trim().length === 0) {
        issues.push({
            field: "type",
            severity: "warn",
            message: "Type is missing.",
            suggestion: "Set type to Task or Bug."
        });
    }
    if (!request.coordinatorId || request.coordinatorId.trim().length === 0) {
        issues.push({
            field: "coordinatorId",
            severity: "warn",
            message: "No coordinator assigned.",
            suggestion: "Assign someone so the task is owned."
        });
    }
    return { issues };
};

const isStartedColumn = (column: IColumn): boolean =>
    /progress|doing|review|qa|testing|done|complete|shipped/i.test(
        column.columnName
    );

export const boardBrief = (context: AiContextProject): IBoardBrief => {
    const { columns, tasks, members } = context;
    const sortedColumns = [...columns].sort((a, b) => a.index - b.index);
    const counts: IBoardBriefCount[] = sortedColumns.map((column) => ({
        columnId: column._id,
        columnName: column.columnName,
        count: tasks.filter((task) => task.columnId === column._id).length
    }));
    const unstartedColumnIds = new Set(
        sortedColumns
            .filter((column) => !isStartedColumn(column))
            .map((column) => column._id)
    );
    const unstartedTasks = tasks.filter((task) =>
        unstartedColumnIds.has(task.columnId)
    );
    const largestUnstarted: IBoardBriefTaskRef[] = [...unstartedTasks]
        .sort((a, b) => (b.storyPoints ?? 0) - (a.storyPoints ?? 0))
        .slice(0, 3)
        .map((task) => ({
            taskId: task._id,
            taskName: task.taskName,
            storyPoints: task.storyPoints
        }));
    const knownMemberIds = new Set(members.map((member) => member._id));
    const unowned: IBoardBriefTaskRef[] = tasks
        .filter(
            (task) =>
                !task.coordinatorId || !knownMemberIds.has(task.coordinatorId)
        )
        .slice(0, 5)
        .map((task) => ({ taskId: task._id, taskName: task.taskName }));
    const startedColumnIds = new Set(
        sortedColumns
            .filter((column) =>
                /progress|doing|review|qa|testing/i.test(column.columnName)
            )
            .map((column) => column._id)
    );
    const workload: IBoardBriefWorkload[] = members
        .map((member) => {
            const open = tasks.filter(
                (task) =>
                    task.coordinatorId === member._id &&
                    !/(done|complete|shipped)/i.test(
                        sortedColumns.find(
                            (column) => column._id === task.columnId
                        )?.columnName ?? ""
                    )
            );
            return {
                memberId: member._id,
                username: member.username,
                openTasks: open.length,
                openPoints: open.reduce(
                    (acc, task) => acc + (task.storyPoints ?? 0),
                    0
                )
            };
        })
        .filter((entry) => entry.openTasks > 0)
        .sort((a, b) => b.openPoints - a.openPoints);

    const totalTasks = tasks.length;
    const inProgress = tasks.filter((task) =>
        startedColumnIds.has(task.columnId)
    ).length;
    const headline = `${totalTasks} task${
        totalTasks === 1 ? "" : "s"
    } on the board, ${inProgress} in progress.`;

    let recommendation =
        "Board looks balanced. Pick the next item from the top of Backlog.";
    let recommendationDetail: IBoardBriefRecommendation = {
        text: recommendation,
        strength: "none",
        basis: "No imbalance, oversized work, or unowned tasks detected.",
        sources: []
    };
    if (unowned.length > 0) {
        recommendation = `Assign coordinators to ${unowned.length} unowned task${
            unowned.length === 1 ? "" : "s"
        } before starting new work.`;
        recommendationDetail = {
            text: recommendation,
            strength: unowned.length >= 3 ? "strong" : "moderate",
            basis: `Counted ${unowned.length} task${
                unowned.length === 1 ? "" : "s"
            } with no coordinator on this board.`,
            sources: unowned.slice(0, 3)
        };
    } else if (
        largestUnstarted[0]?.storyPoints &&
        largestUnstarted[0].storyPoints >= 8
    ) {
        recommendation = `"${largestUnstarted[0].taskName}" is large (${largestUnstarted[0].storyPoints} pts). Consider breaking it down.`;
        recommendationDetail = {
            text: recommendation,
            strength: "moderate",
            basis: `Largest unstarted task is ${largestUnstarted[0].storyPoints} story points.`,
            sources: [largestUnstarted[0]]
        };
    } else if (workload.length > 1) {
        const top = workload[0];
        const bottom = workload[workload.length - 1];
        if (top.openPoints >= bottom.openPoints * 2 && top.openPoints >= 5) {
            recommendation = `${top.username} is carrying ${top.openPoints} pts; consider rebalancing toward ${bottom.username}.`;
            recommendationDetail = {
                text: recommendation,
                strength: "moderate",
                basis: `${top.username} holds ${top.openPoints} open pts vs ${bottom.openPoints} for ${bottom.username} — at least a 2:1 imbalance.`,
                sources: []
            };
        }
    }

    return {
        headline,
        counts,
        largestUnstarted,
        unowned,
        workload,
        recommendation,
        recommendationDetail
    };
};

export interface AiSearchProjectsContext {
    projects: IProject[];
    members: IMember[];
}

const scoreByJaccard = (queryTokens: Set<string>, text: string): number => {
    if (queryTokens.size === 0) return 0;
    return jaccard(queryTokens, tokenSet(text));
};

/**
 * Bucket a raw Jaccard score into a user-facing match strength
 * (Optimization Plan §3 P1-2). Thresholds are calibrated to the
 * deterministic engine: ≥0.45 is a near-literal hit, 0.20–0.45 is a
 * partial overlap, anything else is "weak" and should prompt the user to
 * refine the query.
 */
const matchStrengthFromScore = (score: number): AiSearchMatchStrength => {
    if (score >= 0.45) return "strong";
    if (score >= 0.2) return "moderate";
    return "weak";
};

/**
 * Deterministic semantic-style ranking: token overlap (Jaccard) over
 * task/project text, with PM-synonym expansion (Optimization Plan §3 P1-2).
 *
 * Returns per-result match strength bands so the UI can flag weak matches
 * instead of presenting the entire ranking as "similar". Also returns the
 * synonyms it expanded the query with so users see why a non-literal hit
 * appears (e.g. "todo → backlog, inbox").
 */
export const semanticSearch = (
    kind: "tasks" | "projects",
    query: string,
    context: AiContextProject | AiSearchProjectsContext
): ISearchResult => {
    const q = (query || "").trim();
    if (!q) {
        return { ids: [], rationale: "Enter a description to search." };
    }
    const baseTokens = tokenSet(q);
    if (baseTokens.size === 0) {
        return {
            ids: [],
            rationale: "No semantic match for that phrase."
        };
    }
    const { expanded: queryTokens, additions } = expandWithSynonyms(baseTokens);
    const expandedTerms = describeExpansions(additions);

    if (kind === "tasks") {
        const ctx = context as AiContextProject;
        const scored = ctx.tasks.map((task) => {
            const hay = `${task.taskName} ${task.type} ${task.epic} ${task.note ?? ""}`;
            return { id: task._id, score: scoreByJaccard(queryTokens, hay) };
        });
        scored.sort((a, b) => b.score - a.score);
        const maxScore = scored[0]?.score ?? 0;
        if (maxScore === 0) {
            return {
                ids: [],
                rationale: "No semantic match for that phrase.",
                expandedTerms
            };
        }
        const cutoff = Math.max(0.08, maxScore * 0.42);
        const kept = scored.filter((row) => row.score >= cutoff).slice(0, 50);
        const ids = kept.map((row) => row.id);
        const matches: IAiSearchMatch[] = kept.map((row) => ({
            id: row.id,
            strength: matchStrengthFromScore(row.score)
        }));
        return {
            ids,
            rationale:
                ids.length > 0
                    ? `Ranked ${ids.length} task(s) by similarity to name, type, epic, and notes.`
                    : "No semantic match for that phrase.",
            matches,
            expandedTerms
        };
    }

    const ctx = context as AiSearchProjectsContext;
    const memberById = new Map(ctx.members.map((m) => [m._id, m.username]));
    const scored = ctx.projects.map((project) => {
        const manager = memberById.get(project.managerId) ?? "";
        const hay = `${project.projectName} ${project.organization} ${manager}`;
        return { id: project._id, score: scoreByJaccard(queryTokens, hay) };
    });
    scored.sort((a, b) => b.score - a.score);
    const maxScore = scored[0]?.score ?? 0;
    if (maxScore === 0) {
        return {
            ids: [],
            rationale: "No semantic match for that phrase.",
            expandedTerms
        };
    }
    const cutoff = Math.max(0.08, maxScore * 0.42);
    const kept = scored.filter((row) => row.score >= cutoff).slice(0, 50);
    const ids = kept.map((row) => row.id);
    const matches: IAiSearchMatch[] = kept.map((row) => ({
        id: row.id,
        strength: matchStrengthFromScore(row.score)
    }));
    return {
        ids,
        rationale:
            ids.length > 0
                ? `Ranked ${ids.length} project(s) by similarity to name, organization, and manager.`
                : "No semantic match for that phrase.",
        matches,
        expandedTerms
    };
};
