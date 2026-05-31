import { citationsFromToolResult } from "./chatEngine";

describe("citationsFromToolResult", () => {
    it("extracts task citations from listTasks payloads", () => {
        const refs = citationsFromToolResult("listTasks", [
            {
                _id: "t1",
                taskName: "Investigate flaky login",
                type: "Bug",
                storyPoints: 3
            },
            {
                _id: "t2",
                taskName: "Refactor settings drawer",
                type: "Task",
                storyPoints: 5
            }
        ]);
        expect(refs).toHaveLength(2);
        expect(refs[0]).toEqual({
            source: "task",
            id: "t1",
            quote: "Investigate flaky login"
        });
    });

    it("extracts member citations from listMembers payloads", () => {
        const refs = citationsFromToolResult("listMembers", [
            { _id: "m1", username: "alice" },
            { _id: "m2", username: "bob" }
        ]);
        expect(refs[0]).toEqual({
            source: "member",
            id: "m1",
            quote: "alice"
        });
    });

    it("extracts a single citation from getTask object payloads", () => {
        const refs = citationsFromToolResult("getTask", {
            _id: "t9",
            taskName: "Polish pricing page"
        });
        expect(refs).toEqual([
            { source: "task", id: "t9", quote: "Polish pricing page" }
        ]);
    });

    it("extracts citations from FE tool envelope payloads", () => {
        const refs = citationsFromToolResult("listTasks", {
            tasks: [
                {
                    _id: "t1",
                    taskName: "Investigate flaky login",
                    type: "Bug",
                    storyPoints: 3
                }
            ]
        });
        expect(refs).toEqual([
            {
                source: "task",
                id: "t1",
                quote: "Investigate flaky login"
            }
        ]);
    });

    it("returns no citations for null get envelopes", () => {
        expect(citationsFromToolResult("getTask", { task: null })).toEqual([]);
    });

    it("returns no citations for error payloads", () => {
        expect(citationsFromToolResult("listTasks", { error: "boom" })).toEqual(
            []
        );
        expect(citationsFromToolResult("listTasks", null)).toEqual([]);
    });

    it("caps citations at three to avoid flooding the bubble", () => {
        const big = Array.from({ length: 10 }, (_, i) => ({
            _id: `t${i}`,
            taskName: `Task ${i}`
        }));
        expect(citationsFromToolResult("listTasks", big)).toHaveLength(3);
    });
});
