/**
 * Task urgency/importance enum, lowest → highest. Single source of truth for
 * the union: the modal Select options, the card `PriorityBadge`, and the
 * priority lens all index this same `TaskPriorityLevel` so the values can never
 * drift apart. Mirrors the backend `_PRIORITY_VALUES` enum (PRD §3.2). The
 * stored default is `"none"`, which renders no badge.
 */
type TaskPriorityLevel = "none" | "low" | "medium" | "high" | "urgent";

interface ITask {
    _id: string;
    columnId: string;
    coordinatorId: string;
    epic: string;
    taskName: string;
    type: string;
    note: string;
    projectId: string;
    storyPoints: number;
    index: number;
    startDate?: string;
    dueDate?: string;
    labelIds?: string[];
    assigneeIds?: string[];
    parentTaskId?: string | null;
    /** Optional FK onto a project milestone (PRD milestones). Client-settable via the task modal; same shape/path as parentTaskId. */
    milestoneId?: string | null;
    priority?: TaskPriorityLevel;
    /** Stored prerequisite task ids — the tasks this one depends on (PRD §4.5). Sent by the client; the dependency editor lands in a later slice. */
    dependsOn?: string[];
    /** Server-derived ids of this task's UNFINISHED prerequisites (PRD §4.5). Returned by `GET /tasks`, never sent by the client; a non-empty array means the task is blocked. */
    blockedBy?: string[];
    /** Server-managed completion timestamp (ISO). Set when the task enters a done-category column, cleared (null) when it leaves (PRD §3 lifecycle). Returned by `GET /tasks`; never sent by the client. A truthy value means the task is done. */
    completedAt?: string | null;
    /**
     * Server-managed soft-delete markers (PRD §5.4/§5.5 lifecycle). A task is
     * "trashed" when `deletedAt` is set and "archived" when `archivedAt` is set;
     * the two are INDEPENDENT (a task can be either, both, or neither).
     *
     * CRITICAL — `GET /tasks` excludes both by default, and the
     * `includeTrashed` / `includeArchived` query flags merely WIDEN the result
     * to ALSO return those rows; they do NOT scope it to only-trashed /
     * only-archived. So `?includeTrashed=true` returns active + trashed tasks,
     * and `?includeArchived=true` returns active + archived. The Trash and
     * Archive recovery drawers therefore MUST filter the widened response on
     * these markers client-side. Returned by `GET /tasks`; never sent by the
     * client.
     */
    deletedAt?: string | null;
    archivedAt?: string | null;
}
