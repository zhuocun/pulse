import { summarizeToolResultForUser } from "./chatEngine";

describe("summarizeToolResultForUser plain-language evidence", () => {
    /*
     * Optimization Plan §3 P2-2 — tool summaries must read like evidence
     * the assistant gathered, not like a debug dump. These regression
     * tests guard against re-introducing raw `_id` values, backtick-
     * wrapped identifiers, or tool-name jargon in user-facing strings.
     */
    const fixture = {
        listProjects: [
            { _id: "p_internal_id", projectName: "Roadmap" },
            { _id: "p_other", projectName: "Mobile" }
        ],
        listMembers: [
            { _id: "m_alice_99", email: "alice@example.com", username: "alice" }
        ],
        listBoard: [
            {
                _id: "col_xyz",
                columnName: "Todo",
                index: 0,
                projectId: "p_internal_id"
            }
        ],
        listTasks: [
            {
                _id: "t_internal_id",
                columnId: "col_xyz",
                coordinatorId: "m_alice_99",
                epic: "Auth",
                index: 0,
                note: "",
                projectId: "p_internal_id",
                storyPoints: 3,
                taskName: "Fix login redirect",
                type: "Bug"
            }
        ],
        getTask: {
            _id: "t_internal_id",
            columnId: "col_xyz",
            coordinatorId: "m_alice_99",
            epic: "Auth",
            index: 0,
            note: "Repro on Safari",
            projectId: "p_internal_id",
            storyPoints: 3,
            taskName: "Fix login redirect",
            type: "Bug"
        }
    } as const;

    it.each([
        ["listProjects", fixture.listProjects, "Roadmap"],
        ["listMembers", fixture.listMembers, "alice"],
        ["listBoard", fixture.listBoard, "Todo"],
        ["listTasks", fixture.listTasks, "Fix login redirect"],
        ["getTask", fixture.getTask, "Fix login redirect"]
    ] as const)(
        "%s summary surfaces the display name without raw ids",
        (toolName, payload, expectedName) => {
            const summary = summarizeToolResultForUser(
                toolName,
                payload as unknown
            );
            expect(summary).toContain(expectedName);
            // No raw object ids should leak into the assistant's evidence.
            expect(summary).not.toContain("p_internal_id");
            expect(summary).not.toContain("t_internal_id");
            expect(summary).not.toContain("m_alice_99");
            expect(summary).not.toContain("col_xyz");
            // No backtick-wrapped identifiers either.
            expect(summary).not.toMatch(/`[a-z_0-9]+`/i);
        }
    );

    it("listTasks summary opens with a count sentence the user can scan", () => {
        const summary = summarizeToolResultForUser(
            "listTasks",
            fixture.listTasks
        );
        expect(summary.split("\n")[0]).toMatch(/Checked 1 task\./);
    });

    it("formats FE tool envelope payloads while preserving legacy raw payload support", () => {
        expect(
            summarizeToolResultForUser("listProjects", {
                projects: fixture.listProjects
            })
        ).toContain("Roadmap");
        expect(
            summarizeToolResultForUser("listMembers", {
                members: fixture.listMembers
            })
        ).toContain("alice");
        expect(
            summarizeToolResultForUser("listBoard", {
                columns: fixture.listBoard
            })
        ).toContain("Todo");
        expect(
            summarizeToolResultForUser("getProject", {
                project: fixture.listProjects[0]
            })
        ).toContain("Roadmap");
        expect(
            summarizeToolResultForUser("listTasks", {
                tasks: fixture.listTasks
            })
        ).toContain("Fix login redirect");
        expect(
            summarizeToolResultForUser("getTask", {
                task: fixture.getTask
            })
        ).toContain("Fix login redirect");
    });
});

describe("summarizeToolResultForUser edge cases", () => {
    it("returns error string from object payloads", () => {
        expect(
            summarizeToolResultForUser("listProjects", {
                error: "Upstream failure"
            })
        ).toBe("Upstream failure");
    });

    it("returns no tasks match for empty listTasks arrays", () => {
        expect(summarizeToolResultForUser("listTasks", [])).toBe(
            "No tasks match."
        );
    });

    it("falls back to JSON for malformed listBoard payloads", () => {
        expect(
            summarizeToolResultForUser("listBoard", "not-an-array" as never)
        ).toContain("not-an-array");
    });

    it("falls back for malformed getTask payloads", () => {
        expect(
            summarizeToolResultForUser("getTask", { foo: "bar" } as never)
        ).toContain("foo");
    });

    it("falls back for malformed getProject payloads", () => {
        expect(summarizeToolResultForUser("getProject", [] as never)).toMatch(
            /\[/
        );
    });

    it("falls back for malformed listMembers payloads", () => {
        expect(summarizeToolResultForUser("listMembers", {} as never)).toMatch(
            /\{/
        );
    });

    it("formats getTask without a trailing note line", () => {
        expect(
            summarizeToolResultForUser("getTask", {
                _id: "t1",
                columnId: "c1",
                coordinatorId: "m1",
                epic: "e",
                index: 0,
                note: "",
                projectId: "p1",
                storyPoints: 2,
                taskName: "Work",
                type: "Task"
            })
        ).toMatch(/Work/);
    });
});
