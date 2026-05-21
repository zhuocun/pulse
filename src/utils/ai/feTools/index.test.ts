import { QueryClient } from "@tanstack/react-query";

import type { AutonomyLevel } from "../../../interfaces/agent";

import { FE_TOOL_REGISTRY } from ".";
import { boardSnapshotTool } from "./boardSnapshot";
import { getProjectTool } from "./getProject";
import { listProjectsTool } from "./listProjects";
import type { FeToolContext } from "./types";
import { viewerContextTool } from "./viewerContext";

const expectedNames = [
    "fe.applyApprovedMutation",
    "fe.requestMutationApproval",
    "fe.listProjects",
    "fe.listMembers",
    "fe.getProject",
    "fe.listBoard",
    "fe.listTasks",
    "fe.getTask",
    "fe.boardSnapshot",
    "fe.similarTasks",
    "fe.viewerContext",
    "fe.recentActivity",
    "fe.formDraft",
    "fe.searchCandidates"
];

const buildCtx = (
    queryClient: QueryClient,
    projectId?: string,
    autonomyLevel?: AutonomyLevel
): FeToolContext => ({
    queryClient,
    projectId,
    autonomyLevel
});

describe("FE_TOOL_REGISTRY", () => {
    it("contains the expected 14 tool names", () => {
        const actual = Object.keys(FE_TOOL_REGISTRY).sort();
        expect(actual).toEqual([...expectedNames].sort());
        expect(actual).toHaveLength(14);
    });

    it("each tool's run handles a missing-cache fallback without throwing", async () => {
        const qc = new QueryClient();
        const ctx = buildCtx(qc, "p-missing");
        for (const tool of Object.values(FE_TOOL_REGISTRY)) {
            const result = await tool.run(
                {
                    project_id: "p-missing",
                    task_id: "t1",
                    query: "x",
                    formId: "form-1"
                } as unknown as never,
                ctx
            );
            // We accept any of: undefined, null, [], {}, or a structured
            // object — whichever the tool documents as its empty default.
            expect(result === null || result !== undefined).toBe(true);
        }
    });

    it("boardSnapshot.run produces a snapshot from a populated QueryClient", async () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects"],
            [
                {
                    _id: "p1",
                    createdAt: "0",
                    managerId: "m1",
                    organization: "Org",
                    projectName: "Roadmap"
                }
            ]
        );
        qc.setQueryData<IColumn[]>(
            ["boards", { projectId: "p1" }],
            [
                { _id: "c1", columnName: "Todo", index: 0, projectId: "p1" },
                { _id: "c2", columnName: "Done", index: 1, projectId: "p1" }
            ]
        );
        qc.setQueryData<IMember[]>(
            ["users/members"],
            [{ _id: "m1", email: "a@b.c", username: "Alice" }]
        );
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "x",
                    index: 0,
                    note: "ok",
                    projectId: "p1",
                    storyPoints: 5,
                    taskName: "Fix login",
                    type: "Bug"
                },
                {
                    _id: "t2",
                    columnId: "c1",
                    coordinatorId: "ghost",
                    epic: "x",
                    index: 1,
                    note: "",
                    projectId: "p1",
                    storyPoints: 3,
                    taskName: "Stale",
                    type: "Task"
                }
            ]
        );

        const result = await boardSnapshotTool.run(
            { projectId: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result.counts.total).toBe(2);
        expect(result.counts.byColumn).toEqual([
            { columnId: "c1", count: 2 },
            { columnId: "c2", count: 0 }
        ]);
        expect(result.members).toEqual([{ id: "m1", name: "Alice" }]);
        expect(result.unowned).toHaveLength(1);
        expect(result.unowned[0].taskId).toBe("t2");
        expect(result.workload).toEqual([
            { coordinatorId: "m1", count: 1, points: 5 },
            { coordinatorId: "ghost", count: 1, points: 3 }
        ]);
    });

    it("redacts board snapshot notes longer than 4 KB at suggest autonomy", async () => {
        const qc = new QueryClient();
        const longNote = "a".repeat(5000);
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "ghost",
                    epic: "x",
                    index: 0,
                    note: longNote,
                    projectId: "p1",
                    storyPoints: 1,
                    taskName: "Big",
                    type: "Task"
                }
            ]
        );
        qc.setQueryData<IColumn[]>(
            ["boards", { projectId: "p1" }],
            [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
        );
        const result = await boardSnapshotTool.run(
            { projectId: "p1" },
            buildCtx(qc, "p1", "suggest")
        );
        const note = result.unowned[0]?.note ?? "";
        expect(note.length).toBeLessThan(longNote.length);
        // Length and a stable djb2 hash both appear in the marker so the
        // agent can detect repeated long notes across turns.
        expect(note).toMatch(/redacted len=5000 h=[0-9a-z]+/);
    });

    it("returns full notes at plan autonomy without redaction", async () => {
        const qc = new QueryClient();
        const longNote = "b".repeat(5000);
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "ghost",
                    epic: "x",
                    index: 0,
                    note: longNote,
                    projectId: "p1",
                    storyPoints: 1,
                    taskName: "Big",
                    type: "Task"
                }
            ]
        );
        qc.setQueryData<IColumn[]>(
            ["boards", { projectId: "p1" }],
            [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
        );
        const planCtx = buildCtx(qc, "p1", "plan");
        const planResult = await boardSnapshotTool.run(
            { projectId: "p1" },
            planCtx
        );
        expect(planResult.unowned[0]?.note).toBe(longNote);

        const autoCtx = buildCtx(qc, "p1", "auto");
        const autoResult = await boardSnapshotTool.run(
            { projectId: "p1" },
            autoCtx
        );
        expect(autoResult.unowned[0]?.note).toBe(longNote);
    });

    it('viewerContext reads the IUser cache under the ["users"] key', async () => {
        const qc = new QueryClient();
        qc.setQueryData<IUser>(["users"], {
            _id: "u1",
            email: "alice@example.com",
            likedProjects: [],
            username: "alice"
        });
        const result = await viewerContextTool.run(undefined, buildCtx(qc));
        expect(result.user).toEqual({
            id: "u1",
            username: "alice",
            email: "alice@example.com"
        });
        expect(result.role).toBeNull();
    });

    it("listProjects merges every parametric ['projects', *] cache entry", async () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects", { projectName: "Roadmap" }],
            [
                {
                    _id: "p1",
                    createdAt: "0",
                    managerId: "m1",
                    organization: "Acme",
                    projectName: "Roadmap"
                }
            ]
        );
        qc.setQueryData<IProject[]>(
            ["projects", { managerId: "m2" }],
            [
                {
                    _id: "p2",
                    createdAt: "0",
                    managerId: "m2",
                    organization: "Acme",
                    projectName: "Marketing"
                },
                // Same project surfacing under two parametric keys must
                // dedupe to one entry by `_id`.
                {
                    _id: "p1",
                    createdAt: "0",
                    managerId: "m1",
                    organization: "Acme",
                    projectName: "Roadmap"
                }
            ]
        );
        // Single-project shape from `pages/board.tsx` — should also be
        // collected by listProjects.
        qc.setQueryData<IProject>(["projects", { projectId: "p3" }], {
            _id: "p3",
            createdAt: "0",
            managerId: "m1",
            organization: "Acme",
            projectName: "Solo"
        });
        const result = await listProjectsTool.run(undefined, buildCtx(qc));
        const ids = result.map((p) => p._id).sort();
        expect(ids).toEqual(["p1", "p2", "p3"]);
    });

    it("getProject finds a single-project entry via the parametric cache", async () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject>(["projects", { projectId: "p9" }], {
            _id: "p9",
            createdAt: "0",
            managerId: "m1",
            organization: "Acme",
            projectName: "Singleton"
        });
        const result = await getProjectTool.run(
            { project_id: "p9" },
            buildCtx(qc)
        );
        expect(result?._id).toBe("p9");
        expect(result?.projectName).toBe("Singleton");
    });

    it("getProject returns null when the project is not in any cached variant", async () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects", { projectName: "x" }],
            [
                {
                    _id: "p1",
                    createdAt: "0",
                    managerId: "m1",
                    organization: "Acme",
                    projectName: "x"
                }
            ]
        );
        const result = await getProjectTool.run(
            { project_id: "missing" },
            buildCtx(qc)
        );
        expect(result).toBeNull();
    });

    it("getTask finds a task by snake_case task_id", async () => {
        const { getTaskTool } = await import("./getTask");
        const qc = new QueryClient();
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t42",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "auth",
                    index: 0,
                    note: "",
                    projectId: "p1",
                    storyPoints: 3,
                    taskName: "Fix login",
                    type: "Bug"
                }
            ]
        );
        const result = await getTaskTool.run(
            { task_id: "t42", project_id: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result?._id).toBe("t42");
        expect(result?.taskName).toBe("Fix login");
    });

    it("getTask returns null when task_id is not in cache", async () => {
        const { getTaskTool } = await import("./getTask");
        const qc = new QueryClient();
        const result = await getTaskTool.run(
            { task_id: "t-missing", project_id: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result).toBeNull();
    });

    it("listBoard returns sorted columns using snake_case project_id", async () => {
        const { listBoardTool } = await import("./listBoard");
        const qc = new QueryClient();
        qc.setQueryData<IColumn[]>(
            ["boards", { projectId: "p1" }],
            [
                { _id: "c2", columnName: "Done", index: 1, projectId: "p1" },
                { _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }
            ]
        );
        const result = await listBoardTool.run(
            { project_id: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result).toHaveLength(2);
        expect(result[0]._id).toBe("c1");
        expect(result[1]._id).toBe("c2");
    });

    it("listTasks returns tasks using snake_case project_id", async () => {
        const { listTasksTool } = await import("./listTasks");
        const qc = new QueryClient();
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p5" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "x",
                    index: 0,
                    note: "",
                    projectId: "p5",
                    storyPoints: 1,
                    taskName: "T1",
                    type: "Task"
                }
            ]
        );
        const result = await listTasksTool.run(
            { project_id: "p5" },
            buildCtx(qc, "p5")
        );
        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe("t1");
    });

    it("listMembers returns members using snake_case project_id arg (ignored)", async () => {
        const { listMembersTool } = await import("./listMembers");
        const qc = new QueryClient();
        qc.setQueryData<IMember[]>(
            ["users/members"],
            [{ _id: "m1", email: "a@b.c", username: "Alice" }]
        );
        const result = await listMembersTool.run(
            { project_id: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe("m1");
    });

    it("recentActivity returns {activity: []} shape", async () => {
        const { recentActivityTool } = await import("./recentActivity");
        const qc = new QueryClient();
        const result = await recentActivityTool.run(undefined, buildCtx(qc));
        expect(result).toEqual({ activity: [] });
    });

    it("formDraft returns {draft: null} shape", async () => {
        const { formDraftTool } = await import("./formDraft");
        const qc = new QueryClient();
        const result = await formDraftTool.run(
            { formId: "create-task" },
            buildCtx(qc)
        );
        expect(result).toEqual({ draft: null });
    });

    it("searchCandidates returns task candidates from the cache for kind=tasks", async () => {
        const { searchCandidatesTool } = await import("./searchCandidates");
        const qc = new QueryClient();
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "x",
                    index: 0,
                    note: "some note",
                    projectId: "p1",
                    storyPoints: 3,
                    taskName: "Fix login",
                    type: "Bug"
                },
                {
                    _id: "t2",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "x",
                    index: 1,
                    note: "",
                    projectId: "p1",
                    storyPoints: 1,
                    taskName: "Deploy",
                    type: "Task"
                }
            ]
        );
        const result = await searchCandidatesTool.run(
            { kind: "tasks", query: "login", projectId: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0]).toEqual({
            id: "t1",
            text: "Fix login some note"
        });
        expect(result.candidates[1]).toEqual({ id: "t2", text: "Deploy " });
    });

    it("searchCandidates returns project candidates from the cache for kind=projects", async () => {
        const { searchCandidatesTool } = await import("./searchCandidates");
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects"],
            [
                {
                    _id: "p1",
                    createdAt: "0",
                    managerId: "m1",
                    organization: "Acme",
                    projectName: "Roadmap"
                },
                {
                    _id: "p2",
                    createdAt: "0",
                    managerId: "m1",
                    organization: "Acme",
                    projectName: "Marketing"
                }
            ]
        );
        const result = await searchCandidatesTool.run(
            { kind: "projects", query: "roadmap" },
            buildCtx(qc)
        );
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0].id).toBe("p1");
        expect(result.candidates[0].text).toContain("Roadmap");
        expect(result.candidates[1].id).toBe("p2");
    });

    it("searchCandidates returns {candidates: []} when cache is empty", async () => {
        const { searchCandidatesTool } = await import("./searchCandidates");
        const qc = new QueryClient();
        const taskResult = await searchCandidatesTool.run(
            { kind: "tasks", query: "x", projectId: "p-missing" },
            buildCtx(qc, "p-missing")
        );
        expect(taskResult).toEqual({ candidates: [] });

        const projectResult = await searchCandidatesTool.run(
            { kind: "projects", query: "x" },
            buildCtx(qc)
        );
        expect(projectResult).toEqual({ candidates: [] });
    });

    it("searchCandidates caps results at 50 tasks", async () => {
        const { searchCandidatesTool } = await import("./searchCandidates");
        const qc = new QueryClient();
        const tasks: ITask[] = Array.from({ length: 60 }, (_, i) => ({
            _id: `t${i}`,
            columnId: "c1",
            coordinatorId: "m1",
            epic: "x",
            index: i,
            note: "",
            projectId: "p1",
            storyPoints: 1,
            taskName: `Task ${i}`,
            type: "Task" as const
        }));
        qc.setQueryData<ITask[]>(["tasks", { projectId: "p1" }], tasks);
        const result = await searchCandidatesTool.run(
            { kind: "tasks", query: "task", projectId: "p1" },
            buildCtx(qc, "p1")
        );
        expect(result.candidates).toHaveLength(50);
    });
});
