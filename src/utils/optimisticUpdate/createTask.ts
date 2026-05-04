interface INewTaskParams {
    taskName: string;
    projectId: string;
    columnId: string;
    coordinatorId: string;
    type: "Task";
    epic: "New Feature";
    storyPoints: 1;
    note: "No note yet";
}

const newTaskCallback = (target: INewTaskParams, old: ITask[] | undefined) => {
    if (!old) return old;
    return old.concat({ ...target, _id: "mock" } as ITask);
};

export default newTaskCallback;
