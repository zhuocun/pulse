const deleteTaskCallback = (
    target: { taskId: string },
    old: ITask[] | undefined
) => {
    if (!old) return old;
    const index = old.findIndex((task) => task._id === target.taskId);
    if (index === -1) {
        return old;
    }
    return old.filter((task) => task._id !== target.taskId);
};

export default deleteTaskCallback;
