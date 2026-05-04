const deleteColumnCallback = (
    target: { columnId: string },
    old: IColumn[] | undefined
) => {
    if (!old) return old;
    const deletedColumn = old.find((column) => column._id === target.columnId);
    if (!deletedColumn) {
        return old;
    }

    return old
        .filter((column) => column._id !== target.columnId)
        .map((column) =>
            column.index > deletedColumn.index
                ? { ...column, index: column.index - 1 }
                : column
        );
};

export default deleteColumnCallback;
