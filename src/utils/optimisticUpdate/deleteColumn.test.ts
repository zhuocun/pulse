import deleteColumnCallback from "./deleteColumn";

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    projectId: "project-1",
    index: 0,
    ...overrides
});

describe("deleteColumnCallback", () => {
    it("preserves the missing cache when there is no existing column cache", () => {
        expect(
            deleteColumnCallback({ columnId: "column-1" }, undefined)
        ).toBeUndefined();
    });

    it("removes the matching column and decrements later indexes", () => {
        const oldColumns = [
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 }),
            column({ _id: "column-3", columnName: "Done", index: 2 })
        ];

        const result = deleteColumnCallback(
            { columnId: "column-2" },
            oldColumns
        );

        expect(result).not.toBe(oldColumns);
        expect(result).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-3", columnName: "Done", index: 1 })
        ]);
        expect(oldColumns).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 }),
            column({ _id: "column-3", columnName: "Done", index: 2 })
        ]);
    });

    it("leaves earlier indexes unchanged when deleting a later column", () => {
        const oldColumns = [
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 }),
            column({ _id: "column-3", columnName: "Done", index: 2 })
        ];

        const result = deleteColumnCallback(
            { columnId: "column-3" },
            oldColumns
        );

        expect(result).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 })
        ]);
    });

    it("preserves the existing cache when the target column is missing", () => {
        const oldColumns = [
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 }),
            column({ _id: "column-3", columnName: "Done", index: 2 })
        ];

        const result = deleteColumnCallback(
            { columnId: "missing" },
            oldColumns
        );

        expect(result).toBe(oldColumns);
        expect(result).toEqual(oldColumns);
    });
});
