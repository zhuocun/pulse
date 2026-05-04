import newColumnCallback from "./createColumn";

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    projectId: "project-1",
    index: 0,
    ...overrides
});

describe("newColumnCallback", () => {
    it("creates a first mock column when there is no existing column cache", () => {
        expect(
            newColumnCallback(
                { columnName: "Doing", projectId: "project-1" },
                undefined
            )
        ).toEqual([
            {
                _id: "mock",
                columnName: "Doing",
                projectId: "project-1",
                index: 0
            }
        ]);
    });

    it("appends a mock column at the next index without mutating the old array", () => {
        const oldColumns = [
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 })
        ];

        const result = newColumnCallback(
            { columnName: "Done", projectId: "project-1" },
            oldColumns
        );

        expect(result).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 }),
            {
                _id: "mock",
                columnName: "Done",
                projectId: "project-1",
                index: 2
            }
        ]);
        expect(result).not.toBe(oldColumns);
        expect(oldColumns).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 })
        ]);
    });
});
