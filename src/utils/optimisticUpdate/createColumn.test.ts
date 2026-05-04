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
        const [created] = newColumnCallback(
            { columnName: "Doing", projectId: "project-1" },
            undefined
        );
        expect(created).toMatchObject({
            columnName: "Doing",
            projectId: "project-1",
            index: 0
        });
        expect(created._id.startsWith("tmp-")).toBe(true);
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

        expect(result.slice(0, 2)).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 })
        ]);
        expect(result[2]).toMatchObject({
            columnName: "Done",
            projectId: "project-1",
            index: 2
        });
        expect(result[2]._id.startsWith("tmp-")).toBe(true);
        expect(result).not.toBe(oldColumns);
        expect(oldColumns).toEqual([
            column({ _id: "column-1", columnName: "Todo", index: 0 }),
            column({ _id: "column-2", columnName: "Doing", index: 1 })
        ]);
    });
});
