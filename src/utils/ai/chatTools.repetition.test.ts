import {
    AiChatExecutionContext,
    ChatToolName,
    executeChatToolCall
} from "./chatTools";

const buildCtx = (
    overrides: Partial<AiChatExecutionContext> = {}
): AiChatExecutionContext => ({
    knownColumnIds: new Set(["c1", "c2", "c3"]),
    knownMemberIds: new Set(["m1", "m2", "m3"]),
    knownProjectIds: new Set(["p1", "p2", "p3", "p4"]),
    knownTaskIds: new Set(Array.from({ length: 30 }, (_, i) => `t${i}`)),
    projectId: "p1",
    ...overrides
});

/**
 * Repetition coverage for the Board Copilot read-only tool surface. Each
 * agent turn can fan out into many tool calls (listProjects, then
 * getProject, then listBoard, then listTasks across multiple columns),
 * and we want the dispatcher to:
 *
 *   1. Hit `api()` exactly once per allowed call (no implicit dedup).
 *   2. Short-circuit cleanly when ids fall outside the known sets,
 *      without firing `api()` at all.
 *   3. Be cancellable mid-burst via the AbortSignal.
 *   4. Hand each tool call its own `data` object — no state bleed.
 */
describe("executeChatToolCall repetition", () => {
    it("fires N parallel listProjects calls with independent filters", async () => {
        const ctx = buildCtx();
        const api = jest.fn().mockResolvedValue([]);
        const calls = Array.from({ length: 20 }, (_, i) =>
            executeChatToolCall(
                api,
                ctx,
                {
                    id: String(i),
                    name: "listProjects",
                    arguments: { filter: { projectName: `Project ${i}` } }
                },
                new AbortController().signal
            )
        );
        await Promise.all(calls);

        expect(api).toHaveBeenCalledTimes(20);
        // Each call carries its own projectName — no shared object identity.
        const distinctNames = new Set(
            api.mock.calls.map(
                (c) =>
                    (c[1] as { data: Record<string, string> }).data.projectName
            )
        );
        expect(distinctNames.size).toBe(20);
    });

    it("fires getProject across every known project id and rejects the rest", async () => {
        const ctx = buildCtx();
        const api = jest
            .fn()
            .mockImplementation(
                async (
                    _endpoint,
                    { data }: { data: { projectId: string } }
                ) => ({ _id: data.projectId })
            );

        const knownIds = [...ctx.knownProjectIds];
        const allIds = [...knownIds, "ghost-a", "ghost-b"];

        const results = await Promise.all(
            allIds.map((projectId, i) =>
                executeChatToolCall(
                    api,
                    ctx,
                    {
                        id: String(i),
                        name: "getProject",
                        arguments: { projectId }
                    },
                    new AbortController().signal
                )
            )
        );

        // Known ids hit api(); unknown ids never call api() and return error.
        expect(api).toHaveBeenCalledTimes(knownIds.length);
        knownIds.forEach((id, i) => {
            expect(results[i]).toEqual({ _id: id });
        });
        for (let i = knownIds.length; i < allIds.length; i++) {
            expect(results[i]).toEqual({
                error: "Unknown or disallowed projectId"
            });
        }
    });

    it("fires getTask 30 times, one per known task id", async () => {
        const ctx = buildCtx();
        const api = jest
            .fn()
            .mockImplementation(
                async (_endpoint, { data }: { data: { taskId: string } }) => ({
                    _id: data.taskId
                })
            );

        const ids = [...ctx.knownTaskIds];
        const results = await Promise.all(
            ids.map((taskId, i) =>
                executeChatToolCall(
                    api,
                    ctx,
                    {
                        id: String(i),
                        name: "getTask",
                        arguments: { taskId }
                    },
                    new AbortController().signal
                )
            )
        );

        expect(api).toHaveBeenCalledTimes(ids.length);
        ids.forEach((id, i) => {
            expect(results[i]).toEqual({ _id: id });
            expect(api).toHaveBeenNthCalledWith(i + 1, "tasks", {
                data: { taskId: id },
                method: "GET"
            });
        });
    });

    it("rejects every call in a batch when the signal is already aborted", async () => {
        const ctx = buildCtx();
        const api = jest.fn();
        const controller = new AbortController();
        controller.abort();

        const names: ChatToolName[] = [
            "listProjects",
            "listMembers",
            "getProject",
            "listBoard",
            "listTasks",
            "getTask"
        ];

        const settled = await Promise.allSettled(
            names.map((name, i) =>
                executeChatToolCall(
                    api,
                    ctx,
                    {
                        id: String(i),
                        name,
                        arguments: { projectId: "p1", taskId: "t1" }
                    },
                    controller.signal
                )
            )
        );

        settled.forEach((r) => {
            expect(r.status).toBe("rejected");
            expect(((r as PromiseRejectedResult).reason as Error).name).toBe(
                "AbortError"
            );
        });
        expect(api).not.toHaveBeenCalled();
    });

    it("respects ctx.knownColumnIds / knownMemberIds when listTasks repeats", async () => {
        const ctx = buildCtx();
        const api = jest.fn().mockResolvedValue([]);

        // Build a matrix: known coordinator × known column, known
        // coordinator × unknown column, unknown coordinator × known column.
        const matrix: Array<{
            coordinatorId: string;
            columnId: string;
            keepCoord: boolean;
            keepCol: boolean;
        }> = [];
        for (const coordinatorId of [...ctx.knownMemberIds, "ghost"]) {
            for (const columnId of [...ctx.knownColumnIds, "ghost-col"]) {
                matrix.push({
                    coordinatorId,
                    columnId,
                    keepCoord: ctx.knownMemberIds.has(coordinatorId),
                    keepCol: ctx.knownColumnIds.has(columnId)
                });
            }
        }

        await Promise.all(
            matrix.map((entry, i) =>
                executeChatToolCall(
                    api,
                    ctx,
                    {
                        id: String(i),
                        name: "listTasks",
                        arguments: {
                            projectId: "p1",
                            filter: {
                                coordinatorId: entry.coordinatorId,
                                columnId: entry.columnId
                            }
                        }
                    },
                    new AbortController().signal
                )
            )
        );

        expect(api).toHaveBeenCalledTimes(matrix.length);
        matrix.forEach((entry, i) => {
            const data = (
                api.mock.calls[i][1] as { data: Record<string, string> }
            ).data;
            expect(data.projectId).toBe("p1");
            // Whether the optional filters are passed through depends on
            // membership in the known sets — this is the security
            // contract the dispatcher enforces.
            if (entry.keepCoord) {
                expect(data.coordinatorId).toBe(entry.coordinatorId);
            } else {
                expect(data.coordinatorId).toBeUndefined();
            }
            if (entry.keepCol) {
                expect(data.columnId).toBe(entry.columnId);
            } else {
                expect(data.columnId).toBeUndefined();
            }
        });
    });

    it("does NOT cross-contaminate calls when the same call object is mutated mid-flight", async () => {
        const ctx = buildCtx();
        const api = jest.fn().mockResolvedValue([]);

        // Build calls that share argument identity initially, then mutate.
        const sharedArgs: { projectId: string } = { projectId: "p1" };
        const call1 = executeChatToolCall(
            api,
            ctx,
            { id: "1", name: "listBoard", arguments: sharedArgs },
            new AbortController().signal
        );
        sharedArgs.projectId = "p2";
        const call2 = executeChatToolCall(
            api,
            ctx,
            { id: "2", name: "listBoard", arguments: sharedArgs },
            new AbortController().signal
        );
        await Promise.all([call1, call2]);

        // Both calls used the value of `projectId` at the moment they
        // were dispatched. The first call was already in-flight (Promise
        // microtask) before the mutation; the dispatcher captured "p1".
        // The second captured "p2". Each call's `data` object is fresh.
        expect(api).toHaveBeenCalledTimes(2);
        const data1 = api.mock.calls[0][1] as { data: Record<string, string> };
        const data2 = api.mock.calls[1][1] as { data: Record<string, string> };
        expect(data1.data.projectId).toBe("p1");
        expect(data2.data.projectId).toBe("p2");
        // The two data objects are distinct references — mutating one
        // never affects the other.
        expect(data1.data).not.toBe(data2.data);
    });

    it("survives a long sequential burst of mixed tool types", async () => {
        const ctx = buildCtx();
        const api = jest.fn().mockResolvedValue({ ok: true });

        const sequence: ChatToolName[] = [
            "listProjects",
            "getProject",
            "listMembers",
            "listBoard",
            "listTasks",
            "getTask"
        ];
        const REPEAT = 6; // 6 × 6 = 36 calls

        for (let r = 0; r < REPEAT; r++) {
            for (const name of sequence) {
                await executeChatToolCall(
                    api,
                    ctx,
                    {
                        id: `${r}:${name}`,
                        name,
                        arguments: {
                            projectId: "p1",
                            taskId: "t1",
                            filter: { type: "Bug" }
                        }
                    },
                    new AbortController().signal
                );
            }
        }

        expect(api).toHaveBeenCalledTimes(sequence.length * REPEAT);
        // Spot check: every call's endpoint is one of the read-only set.
        const allowedEndpoints = new Set([
            "projects",
            "users/members",
            "boards",
            "tasks"
        ]);
        for (const call of api.mock.calls) {
            expect(allowedEndpoints.has(call[0] as string)).toBe(true);
            expect((call[1] as { method: string }).method).toBe("GET");
        }
    });
});
