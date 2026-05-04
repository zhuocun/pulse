const deleteProjectCallback = (
    target: { projectId: string },
    old: IProject[] | undefined
) => {
    if (!old) return old;
    const index = old.findIndex((project) => project._id === target.projectId);
    if (index === -1) {
        return old;
    }
    return old.filter((project) => project._id !== target.projectId);
};

export default deleteProjectCallback;
