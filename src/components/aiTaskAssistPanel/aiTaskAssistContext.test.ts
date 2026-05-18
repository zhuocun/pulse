import {
    absorbUseAiRunRejection,
    buildLocalAiContext,
    buildLocalEstimateRunPayload,
    buildLocalReadinessRunPayload
} from "./aiTaskAssistContext";

describe("aiTaskAssistContext", () => {
    const columns: IColumn[] = [
        { _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }
    ];
    const tasks: ITask[] = [
        {
            _id: "t1",
            columnId: "c1",
            coordinatorId: "m1",
            epic: "Auth",
            index: 0,
            note: "note",
            projectId: "p1",
            storyPoints: 3,
            taskName: "Task",
            type: "Task"
        }
    ];
    const members: IMember[] = [
        { _id: "m1", email: "a@b.c", username: "Alice" }
    ];

    it("buildLocalAiContext wires project, board, tasks, and members", () => {
        expect(buildLocalAiContext("p1", columns, tasks, members)).toEqual({
            project: { _id: "p1", projectName: "" },
            columns,
            tasks,
            members
        });
    });

    it("buildLocalEstimateRunPayload shares context with readiness payloads", () => {
        const context = buildLocalAiContext("p1", columns, tasks, members);
        const fields = {
            taskName: "OAuth login",
            note: "desc",
            epic: "Auth",
            type: "Task"
        };

        expect(
            buildLocalEstimateRunPayload(fields, {
                tasks,
                excludeTaskId: "t9",
                context
            })
        ).toEqual({
            estimate: {
                ...fields,
                tasks,
                excludeTaskId: "t9",
                context
            }
        });

        expect(
            buildLocalReadinessRunPayload(
                { ...fields, coordinatorId: "m1" },
                context
            )
        ).toEqual({
            readiness: {
                ...fields,
                coordinatorId: "m1",
                context
            }
        });
    });

    it("absorbUseAiRunRejection is a no-op sink for useAi.run rejections", () => {
        expect(absorbUseAiRunRejection()).toBeUndefined();
    });
});
