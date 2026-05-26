import { TOOL_VERB, humanizeTool } from "./toolDisplay";

describe("toolDisplay", () => {
    it("humanizes canonical tools and fe aliases consistently", () => {
        const aliases: Array<[string, string]> = [
            ["listProjects", "fe.listProjects"],
            ["listMembers", "fe.listMembers"],
            ["listBoard", "fe.listBoard"],
            ["listTasks", "fe.listTasks"],
            ["getProject", "fe.getProject"],
            ["getTask", "fe.getTask"]
        ];

        for (const [bareName, feName] of aliases) {
            expect(humanizeTool(feName)).toBe(TOOL_VERB[bareName]);
        }
    });

    it("strips fe prefixes before fallback sentence-casing", () => {
        expect(humanizeTool("fe.boardSnapshot")).toBe("Board Snapshot");
    });
});
