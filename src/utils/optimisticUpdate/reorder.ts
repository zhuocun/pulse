interface ITaskOrderParams {
    fromId: string;
    referenceId?: string;
    fromColumnId: string;
    referenceColumnId: string;
    type: "after" | "before";
}

interface IColumnOrderParams {
    fromId: string;
    referenceId?: string;
    type: "after" | "before";
}

const moveItem = <T extends { _id: string }>(
    objArray: T[],
    from: number,
    to: number
) => {
    const copiedArray = [...objArray];
    const [removedItem] = copiedArray.splice(from, 1);

    if (!removedItem) {
        return [...objArray];
    }

    copiedArray.splice(to, 0, removedItem);
    return copiedArray;
};

const reorder = <T extends { _id: string }>({
    fromId,
    type,
    referenceId,
    objArray
}: {
    objArray: T[];
    fromId: string;
    type: "after" | "before";
    referenceId?: string;
}) => {
    const movingItemIndex = objArray.findIndex((item) => item._id === fromId);

    if (movingItemIndex === -1) {
        return [...objArray];
    }

    if (!referenceId) {
        if (movingItemIndex === objArray.length - 1) {
            return [...objArray];
        }

        return moveItem(objArray, movingItemIndex, objArray.length - 1);
    }

    const targetIndex = objArray.findIndex((item) => item._id === referenceId);

    if (targetIndex === -1) {
        return [...objArray];
    }

    const destinationIndex =
        type === "after"
            ? targetIndex > movingItemIndex
                ? targetIndex
                : targetIndex + 1
            : targetIndex > movingItemIndex
              ? targetIndex - 1
              : targetIndex;

    if (destinationIndex === movingItemIndex) {
        return [...objArray];
    }

    return moveItem(objArray, movingItemIndex, destinationIndex);
};

const updateIndexes = <T extends { index: number }>(items: T[]) =>
    items.map((item, index) => ({ ...item, index }));

export const taskCallback = (
    target: ITaskOrderParams,
    old: ITask[] | undefined
) => {
    if (!old) {
        return old;
    }
    const orderedList = reorder({ objArray: old, ...target }) as ITask[];

    return updateIndexes(
        orderedList.map((item) =>
            item._id === target.fromId
                ? { ...item, columnId: target.referenceColumnId }
                : { ...item }
        )
    );
};

export const columnCallback = (
    target: IColumnOrderParams,
    old: IColumn[] | undefined
) => {
    if (!old) {
        return old;
    }
    return updateIndexes(reorder({ objArray: old, ...target }) as IColumn[]);
};
