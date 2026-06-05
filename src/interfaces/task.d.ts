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
    priority?: TaskPriorityLevel;
}
