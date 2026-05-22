import { createOptimisticClientId } from "../optimisticClientId";

interface INewTaskParams {
    taskName: string;
    projectId: string;
    columnId: string;
    coordinatorId: string;
    type?: string;
    epic?: string;
    storyPoints?: number;
    note?: string;
}

const newTaskCallback = (target: INewTaskParams, old: ITask[] | undefined) => {
    const tasks = old ?? [];
    return tasks.concat({
        ...target,
        _id: createOptimisticClientId()
    } as ITask);
};

export default newTaskCallback;
