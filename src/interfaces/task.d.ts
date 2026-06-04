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
}
