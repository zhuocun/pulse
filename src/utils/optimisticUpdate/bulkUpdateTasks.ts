/**
 * Optimistic callback for the bulk metadata edit (PRD-GAP-008 —
 * `PUT /tasks/bulk`). The wire payload is `{ taskIds, changes }`; this
 * patches every selected task in the cached task list with the same
 * `changes` map so the edit shows instantly across columns, then
 * `useReactMutation` reconciles on the server response / rolls every card
 * back together on error.
 *
 * Routing fields (`columnId` / `projectId`) never reach here — the toolbar
 * doesn't offer them and the server drops them — so the optimistic patch
 * can't move a card between columns mid-flight.
 */
const bulkUpdateTasksCallback = (
    target: { taskIds: string[]; changes: Partial<ITask> },
    old: ITask[] | undefined
) => {
    if (!old) {
        return old;
    }
    const ids = new Set(target.taskIds);
    return old.map((task) =>
        ids.has(task._id) ? { ...task, ...target.changes } : task
    );
};

export default bulkUpdateTasksCallback;
