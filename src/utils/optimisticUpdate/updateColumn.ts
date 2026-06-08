/**
 * Optimistic callback for the column-edit PUT (PRD §5.5 — WIP-limit
 * control). Mirrors the shipped column create/delete callbacks: it patches
 * the matching column in the cached board list with the edited fields
 * (`columnName` / `category` / `wipLimit`) so the rename + WIP change show
 * instantly, then `useReactMutation` reconciles on the server response /
 * rolls back on error.
 */
const updateColumnCallback = (
    target: Partial<IColumn> & { _id: string },
    old: IColumn[] | undefined
) => {
    if (!old) {
        return old;
    }
    return old.map((column) =>
        column._id === target._id ? { ...column, ...target } : column
    );
};

export default updateColumnCallback;
