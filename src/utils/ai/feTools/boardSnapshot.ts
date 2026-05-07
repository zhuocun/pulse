import type { FeTool, FeToolContext } from "./types";

/**
 * `fe.boardSnapshot` — compact, model-friendly summary of the board state
 * for the current project (PRD §5.7). Counts, members, unowned tasks, and
 * per-coordinator workload are produced from the React Query cache.
 *
 * Long task notes are redacted to `head + tail + length + djb2 hash` to
 * keep the agent input small at the lowest autonomy ("suggest"). At
 * "plan" / "auto" autonomy the agent is already trusted to mutate the
 * board, so the full note is sent through. The djb2 hash is a stable
 * non-cryptographic fingerprint so the agent can detect whether two
 * redactions reference the same underlying note across turns without
 * shipping the raw bytes.
 */
const NOTE_BUDGET = 4 * 1024;
const HEAD_BYTES = 1024;
const TAIL_BYTES = 512;

/**
 * djb2 string hash (Bernstein, 1991). Not cryptographic — chosen for a
 * tight, dependency-free implementation that yields a stable token for
 * dedup purposes only.
 */
const djb2 = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
};

const redactNote = (
    note: string | undefined,
    autonomy: FeToolContext["autonomyLevel"]
): string | undefined => {
    if (!note) return note;
    if (note.length <= NOTE_BUDGET) return note;
    // At "plan" / "auto" the agent is already authorised to mutate the
    // board — redacting at that level only hurts answer quality. Only
    // redact at "suggest" (or when autonomy is unspecified, which is the
    // safe default for tests / shells without autonomy plumbed in).
    if (autonomy === "plan" || autonomy === "auto") return note;
    const head = note.slice(0, HEAD_BYTES);
    const tail = note.slice(-TAIL_BYTES);
    return `${head}…[redacted len=${note.length} h=${djb2(note)}]…${tail}`;
};

export interface BoardSnapshotResult {
    counts: {
        total: number;
        byColumn: Array<{ columnId: string; count: number }>;
    };
    members: Array<{ id: string; name: string }>;
    unowned: Array<{ taskId: string; name: string; note?: string }>;
    workload: Array<{ coordinatorId: string; count: number; points: number }>;
}

export const boardSnapshotTool: FeTool<
    { project_id?: string; projectId?: string } | void,
    BoardSnapshotResult
> = {
    name: "fe.boardSnapshot",
    description:
        "Compact board summary: counts per column, members, unowned tasks, workload.",
    run: (args, ctx) => {
        // Accept both snake_case (the v2.1 BE convention, post-a59539f)
        // and camelCase (legacy callers) so the contract is resilient
        // even if either side lags the migration.
        const projectId =
            (args && "project_id" in args ? args.project_id : undefined) ??
            (args && "projectId" in args ? args.projectId : undefined) ??
            ctx.projectId;
        const empty: BoardSnapshotResult = {
            counts: { total: 0, byColumn: [] },
            members: [],
            unowned: [],
            workload: []
        };
        if (!projectId) return empty;
        const tasks =
            ctx.queryClient.getQueryData<ITask[]>(["tasks", { projectId }]) ??
            [];
        const columns =
            ctx.queryClient.getQueryData<IColumn[]>([
                "boards",
                { projectId }
            ]) ?? [];
        const members =
            ctx.queryClient.getQueryData<IMember[]>(["users/members"]) ?? [];

        const sortedColumns = [...columns].sort((a, b) => a.index - b.index);
        const memberById = new Map(members.map((m) => [m._id, m]));

        const byColumn = sortedColumns.map((col) => ({
            columnId: col._id,
            count: tasks.filter((t) => t.columnId === col._id).length
        }));
        const unowned = tasks
            .filter((t) => !t.coordinatorId || !memberById.has(t.coordinatorId))
            .map((t) => ({
                taskId: t._id,
                name: t.taskName,
                note: redactNote(t.note, ctx.autonomyLevel)
            }));
        const workloadMap = new Map<
            string,
            { coordinatorId: string; count: number; points: number }
        >();
        for (const t of tasks) {
            if (!t.coordinatorId) continue;
            const entry = workloadMap.get(t.coordinatorId) ?? {
                coordinatorId: t.coordinatorId,
                count: 0,
                points: 0
            };
            entry.count += 1;
            entry.points += t.storyPoints ?? 0;
            workloadMap.set(t.coordinatorId, entry);
        }
        return {
            counts: { total: tasks.length, byColumn },
            members: members.map((m) => ({ id: m._id, name: m.username })),
            unowned,
            workload: Array.from(workloadMap.values()).sort(
                (a, b) => b.points - a.points
            )
        };
    }
};
