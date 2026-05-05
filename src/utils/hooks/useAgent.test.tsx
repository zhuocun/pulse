import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import type { StreamPart } from "../../interfaces/agent";

jest.mock("../ai/agentClient", () => {
    const actual =
        jest.requireActual<typeof import("../ai/agentClient")>(
            "../ai/agentClient"
        );
    return {
        __esModule: true,
        ...actual,
        streamAgent: jest.fn()
    };
});

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiBaseUrl: "https://agents.example",
        aiEnabled: true,
        aiUseLocalEngine: false,
        apiBaseUrl: "/api/v1"
    }
}));

// eslint-disable-next-line simple-import-sort/imports
import { streamAgent } from "../ai/agentClient";
import { ANALYTICS_EVENTS, setAnalyticsSink } from "../../constants/analytics";
import useAgent, {
    NUDGE_EXPIRY_MS,
    NUDGE_INBOX_MAX,
    reduceNudgeInbox,
    type AgentMessage
} from "./useAgent";

const mockedStream = streamAgent as unknown as jest.Mock;

async function* fromParts(parts: StreamPart[]) {
    for (const part of parts) {
        yield part;
    }
}

const wrapper = (queryClient: QueryClient) => {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
    Wrapper.displayName = "TestWrapper";
    return Wrapper;
};

describe("useAgent", () => {
    beforeEach(() => {
        mockedStream.mockReset();
    });

    it("starts a run and reduces messages from streamed chunks", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                { type: "updates", ns: ["root"], data: { step: 1 } },
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Hello " }, {}]
                },
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "world" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("board-coach", { projectId: "p1", userId: "u1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("hi");
        });

        await waitFor(() => {
            expect(result.current.isStreaming).toBe(false);
        });

        const assistantMsgs = result.current.state.messages.filter(
            (m) => m.role === "assistant"
        );
        expect(assistantMsgs[assistantMsgs.length - 1]?.content).toBe(
            "Hello world"
        );
        expect(result.current.state.lastUpdate).toEqual({ step: 1 });
        expect(mockedStream).toHaveBeenCalledTimes(1);
    });

    it("normalizes undefined user message content on start so wire payload and state stay string-safe", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "ok" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("board-coach", { projectId: "p1", userId: "u1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start({
                messages: [
                    { role: "user", content: undefined as unknown as string }
                ]
            });
        });

        await waitFor(() => {
            expect(result.current.isStreaming).toBe(false);
        });

        const userMsgs = result.current.state.messages.filter(
            (m) => m.role === "user"
        );
        expect(userMsgs[userMsgs.length - 1]?.content).toBe("");
        const wireMessages = mockedStream.mock.calls[0][0].body.input
            .messages as AgentMessage[];
        expect(wireMessages[wireMessages.length - 1]?.content).toBe("");
    });

    // The agent server derives identity from the JWT and rejects any
    // client-supplied `user_id` in `config.configurable` with HTTP 400
    // (see jira-python-server `app/routers/agents.py::_normalize_payload`).
    // Even when the caller passes `userId` as a hook option (it's still
    // used for FE-internal bookkeeping like `feToolContext.userId`), it
    // must NOT appear on the wire body.
    it("does not put user_id on the wire even when options.userId is set", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "ok" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("board-coach", { projectId: "p1", userId: "u1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("hi");
        });

        await waitFor(() => {
            expect(result.current.isStreaming).toBe(false);
        });

        const configurable =
            mockedStream.mock.calls[0][0].body.config.configurable;
        expect(configurable).not.toHaveProperty("user_id");
        expect(configurable.thread_id).toEqual(expect.any(String));
        expect(configurable.project_id).toBe("p1");
        expect(configurable.autonomy).toBe("plan");
    });

    it("auto-resumes on an interrupt for a known FE tool", async () => {
        mockedStream
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "interrupt",
                        ns: ["root"],
                        data: {
                            tool: "fe.listProjects",
                            args: {}
                        }
                    }
                ])
            )
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "Done." }, {}]
                    }
                ])
            );
        const queryClient = new QueryClient();
        queryClient.setQueryData<IProject[]>(
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
        const { result } = renderHook(
            () => useAgent("board-coach", { projectId: "p1", userId: "u1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("list projects");
        });

        await waitFor(() => {
            expect(result.current.isStreaming).toBe(false);
        });

        expect(mockedStream).toHaveBeenCalledTimes(2);
        const secondCall = mockedStream.mock.calls[1][0];
        expect(secondCall.body.command?.resume).toBeDefined();
        expect(result.current.pendingInterrupt).toBeNull();
    });

    it("surfaces a mutation_proposal as pendingProposal", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "mutation_proposal",
                        proposal: {
                            proposal_id: "mp-1",
                            description: "Move task",
                            diff: {
                                task_updates: [
                                    {
                                        task_id: "t1",
                                        field: "columnId",
                                        from: "c1",
                                        to: "c2"
                                    }
                                ]
                            },
                            risk: "low",
                            undoable: true
                        }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("board-coach", { projectId: "p1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("Plan a move");
        });

        await waitFor(() => {
            expect(result.current.pendingProposal?.proposal_id).toBe("mp-1");
        });
    });

    it("captures citations and nudges from custom events", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "citation",
                        refs: [
                            {
                                source: "task",
                                id: "t1",
                                quote: "Fix login"
                            }
                        ]
                    }
                },
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "nudge",
                        nudge: {
                            nudge_id: "n1",
                            kind: "load_imbalance",
                            project_id: "p1",
                            summary: "Alice is overloaded",
                            target_ids: [],
                            severity: "warn"
                        }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("triage", { projectId: "p1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("triage");
        });

        await waitFor(() => {
            expect(result.current.citations).toHaveLength(1);
            expect(result.current.nudges).toHaveLength(1);
        });
    });

    it("surfaces a suggestion event as lastSuggestion and clears it via clearSuggestion", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "suggestion",
                        surface: "brief",
                        payload: { summary: "Sprint is at capacity." }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("board-brief-agent", { projectId: "p1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("generate brief");
        });

        await waitFor(() => {
            expect(result.current.lastSuggestion).toEqual({
                surface: "brief",
                payload: { summary: "Sprint is at capacity." }
            });
        });

        act(() => {
            result.current.clearSuggestion();
        });

        expect(result.current.lastSuggestion).toBeNull();
    });

    it("resets lastSuggestion at the start of every new turn", async () => {
        mockedStream
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "suggestion",
                            surface: "estimate",
                            payload: { points: 5 }
                        }
                    }
                ])
            )
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "Done." }, {}]
                    }
                ])
            );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("task-estimation-agent", { projectId: "p1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("estimate task");
        });

        await waitFor(() => {
            expect(result.current.lastSuggestion?.surface).toBe("estimate");
        });

        await act(async () => {
            await result.current.start("second turn");
        });

        // Second start() must reset lastSuggestion before the new stream begins.
        await waitFor(() => {
            expect(result.current.lastSuggestion).toBeNull();
        });
    });

    it("resets citations and nudges at the start of every new turn", async () => {
        // First turn emits one citation and one nudge.
        mockedStream
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "citation",
                            refs: [
                                {
                                    source: "task",
                                    id: "t1",
                                    quote: "First"
                                }
                            ]
                        }
                    },
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "nudge",
                            nudge: {
                                nudge_id: "n1",
                                kind: "load_imbalance",
                                project_id: "p1",
                                summary: "Alice overloaded",
                                target_ids: [],
                                severity: "warn"
                            }
                        }
                    }
                ])
            )
            // Second turn emits a different citation only.
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "citation",
                            refs: [
                                {
                                    source: "task",
                                    id: "t2",
                                    quote: "Second"
                                }
                            ]
                        }
                    }
                ])
            );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () => useAgent("board-coach", { projectId: "p1", userId: "u1" }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("first turn");
        });

        await waitFor(() => {
            expect(result.current.citations).toHaveLength(1);
            expect(result.current.nudges).toHaveLength(1);
        });
        expect(result.current.citations[0].id).toBe("t1");

        await act(async () => {
            await result.current.start("second turn");
        });

        // Second turn's start() must drop the previous turn's surfaces
        // (per review follow-up #10) before streaming new ones in.
        await waitFor(() => {
            expect(result.current.citations).toHaveLength(1);
            expect(result.current.citations[0].id).toBe("t2");
            // Nudges array reset and not reloaded by the second turn.
            expect(result.current.nudges).toHaveLength(0);
        });
    });

    it("reset clears state and assigns a new threadId for the next run", async () => {
        mockedStream.mockReturnValue(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "ok" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(
            () =>
                useAgent("board-coach", {
                    projectId: "p1",
                    initialThreadId: "thread-fixed"
                }),
            { wrapper: wrapper(queryClient) }
        );

        await act(async () => {
            await result.current.start("hi");
        });

        expect(
            mockedStream.mock.calls[0][0].body.config.configurable.thread_id
        ).toBe("thread-fixed");

        act(() => {
            result.current.reset();
        });

        expect(result.current.state.messages).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(result.current.isStreaming).toBe(false);
    });

    describe("analytics — AGENT_TURN_STARTED / AGENT_TURN_COMPLETED", () => {
        it("fires AGENT_TURN_STARTED when the stream opens and AGENT_TURN_COMPLETED when it finishes", async () => {
            mockedStream.mockReturnValueOnce(
                fromParts([
                    {
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "hi" }, {}]
                    }
                ])
            );
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () => useAgent("board-coach", { projectId: "p1" }),
                { wrapper: wrapper(queryClient) }
            );
            try {
                await act(async () => {
                    await result.current.start("hello");
                });
                await waitFor(() => {
                    expect(result.current.isStreaming).toBe(false);
                });
            } finally {
                setAnalyticsSink(previous);
            }

            const startedCall = tracked.find(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_TURN_STARTED
            );
            const completedCall = tracked.find(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_TURN_COMPLETED
            );

            expect(startedCall).toBeDefined();
            expect(startedCall?.[1]).toMatchObject({
                agentName: "board-coach"
            });

            expect(completedCall).toBeDefined();
            expect(completedCall?.[1]).toMatchObject({
                agentName: "board-coach",
                durationMs: expect.any(Number)
            });
            // Should not be on the error path
            expect(completedCall?.[1]).not.toHaveProperty("error");
        });

        it("fires AGENT_TURN_COMPLETED with error:true on a terminal stream error", async () => {
            // Plain async-iterable whose first .next() rejects -- avoids the
            // require-yield lint trap that an empty async generator would hit.
            mockedStream.mockReturnValueOnce({
                [Symbol.asyncIterator]() {
                    return this;
                },
                async next() {
                    throw new Error("server exploded");
                }
            } as unknown as AsyncIterable<never>);
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () => useAgent("board-coach", { projectId: "p1" }),
                { wrapper: wrapper(queryClient) }
            );
            try {
                await act(async () => {
                    await result.current.start("hello");
                });
                await waitFor(() => {
                    expect(result.current.isStreaming).toBe(false);
                });
            } finally {
                setAnalyticsSink(previous);
            }

            const completedCall = tracked.find(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_TURN_COMPLETED
            );
            expect(completedCall).toBeDefined();
            expect(completedCall?.[1]).toMatchObject({ error: true });
        });

        it("does NOT fire AGENT_TURN_COMPLETED when the stream is aborted", async () => {
            // Hold a reference to the Promise resolver so we can unblock the
            // generator after abort, keeping the test deterministic.
            const releaseRef: { fn: (() => void) | null } = { fn: null };
            mockedStream.mockReturnValueOnce(
                (async function* () {
                    await new Promise<void>((resolve) => {
                        releaseRef.fn = resolve;
                    });
                    yield {
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "hi" }, {}]
                    } as StreamPart;
                })()
            );
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () => useAgent("board-coach", { projectId: "p1" }),
                { wrapper: wrapper(queryClient) }
            );
            try {
                // Start but don't await — abort immediately.
                const startPromise = act(async () => {
                    result.current.start("hello").catch(() => undefined);
                });
                act(() => {
                    result.current.abort();
                });
                // Unblock the generator so the promise resolves.
                if (releaseRef.fn !== null) releaseRef.fn();
                await startPromise;
                await waitFor(() => {
                    expect(result.current.isStreaming).toBe(false);
                });
            } finally {
                setAnalyticsSink(previous);
            }

            const completedCalls = tracked.filter(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_TURN_COMPLETED
            );
            expect(completedCalls).toHaveLength(0);
        });
    });

    // Fix 7 — project-AI opt-out check
    describe("project AI disabled guard", () => {
        const { setProjectAiDisabledInStorage } = jest.requireActual<
            typeof import("../ai/projectAiStorage")
        >("../ai/projectAiStorage");

        afterEach(() => {
            // Re-enable the project after each test.
            setProjectAiDisabledInStorage("p-disabled", false);
        });

        it("throws AgentForbiddenError and does not call streamAgent when project AI is disabled", async () => {
            setProjectAiDisabledInStorage("p-disabled", true);

            const queryClient = new QueryClient();
            const { result } = renderHook(
                () =>
                    useAgent("board-coach", {
                        projectId: "p-disabled"
                    }),
                { wrapper: wrapper(queryClient) }
            );

            let caught: Error | null = null;
            await act(async () => {
                try {
                    await result.current.start("hi");
                } catch (err) {
                    caught = err as Error;
                }
            });

            expect(caught).not.toBeNull();
            expect(caught!.name).toBe("AgentForbiddenError");
            // No fetch should have been initiated.
            expect(mockedStream).not.toHaveBeenCalled();
        });

        it("starts normally when the project AI is enabled", async () => {
            mockedStream.mockReturnValueOnce(
                fromParts([
                    {
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "ok" }, {}]
                    }
                ])
            );

            setProjectAiDisabledInStorage("p-disabled", false);
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () =>
                    useAgent("board-coach", {
                        projectId: "p-disabled"
                    }),
                { wrapper: wrapper(queryClient) }
            );

            await act(async () => {
                await result.current.start("hello");
            });

            expect(mockedStream).toHaveBeenCalledTimes(1);
        });
    });

    describe("nudge inbox rules (PRD AC-V14)", () => {
        const baseNudge = {
            project_id: "p1",
            severity: "warn" as const,
            target_ids: [],
            summary: ""
        };

        describe("reduceNudgeInbox (pure)", () => {
            it("prepends newest first and keeps prior entries", () => {
                const t0 = 1_700_000_000_000;
                const first = reduceNudgeInbox(
                    [],
                    {
                        ...baseNudge,
                        nudge_id: "n1",
                        kind: "wip_overflow",
                        summary: "first"
                    },
                    t0
                );
                const second = reduceNudgeInbox(
                    first,
                    {
                        ...baseNudge,
                        nudge_id: "n2",
                        kind: "stale_task",
                        summary: "second"
                    },
                    t0 + 1000
                );
                expect(second.map((e) => e.nudge.nudge_id)).toEqual([
                    "n2",
                    "n1"
                ]);
            });

            it("dedups by (kind, project_id) so the newer entry wins", () => {
                const t0 = 1_700_000_000_000;
                const seeded = reduceNudgeInbox(
                    [],
                    {
                        ...baseNudge,
                        nudge_id: "old",
                        kind: "wip_overflow",
                        summary: "old"
                    },
                    t0
                );
                const next = reduceNudgeInbox(
                    seeded,
                    {
                        ...baseNudge,
                        nudge_id: "new",
                        kind: "wip_overflow",
                        summary: "new"
                    },
                    t0 + 5000
                );
                expect(next).toHaveLength(1);
                expect(next[0].nudge.nudge_id).toBe("new");
            });

            it("preserves entries of the same kind from a different project", () => {
                const t0 = 1_700_000_000_000;
                const seeded = reduceNudgeInbox(
                    [],
                    {
                        ...baseNudge,
                        project_id: "p1",
                        nudge_id: "n1",
                        kind: "wip_overflow",
                        summary: ""
                    },
                    t0
                );
                const next = reduceNudgeInbox(
                    seeded,
                    {
                        ...baseNudge,
                        project_id: "p2",
                        nudge_id: "n2",
                        kind: "wip_overflow",
                        summary: ""
                    },
                    t0 + 1
                );
                expect(next).toHaveLength(2);
            });

            it(`caps the inbox at NUDGE_INBOX_MAX = ${NUDGE_INBOX_MAX}`, () => {
                let entries: ReturnType<typeof reduceNudgeInbox> = [];
                for (let i = 0; i < NUDGE_INBOX_MAX + 3; i += 1) {
                    entries = reduceNudgeInbox(
                        entries,
                        {
                            ...baseNudge,
                            nudge_id: `n${i}`,
                            // Use distinct kinds (cycle if needed) so dedup
                            // doesn't collapse the entries before the cap.
                            kind: (
                                [
                                    "wip_overflow",
                                    "stale_task",
                                    "unowned_bug",
                                    "load_imbalance"
                                ] as const
                            )[i % 4],
                            project_id: `p${i}`,
                            summary: ""
                        },
                        1_700_000_000_000 + i
                    );
                }
                expect(entries).toHaveLength(NUDGE_INBOX_MAX);
            });

            it("drops entries older than the 4-hour expiry on insert", () => {
                const t0 = 1_700_000_000_000;
                const seeded = reduceNudgeInbox(
                    [],
                    {
                        ...baseNudge,
                        nudge_id: "stale",
                        kind: "wip_overflow",
                        summary: ""
                    },
                    t0
                );
                const after = reduceNudgeInbox(
                    seeded,
                    {
                        ...baseNudge,
                        project_id: "p2",
                        nudge_id: "fresh",
                        kind: "stale_task",
                        summary: ""
                    },
                    t0 + NUDGE_EXPIRY_MS + 1
                );
                expect(after.map((e) => e.nudge.nudge_id)).toEqual(["fresh"]);
            });
        });

        it("dismissNudge removes a single nudge by id", async () => {
            mockedStream.mockReturnValueOnce(
                fromParts([
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "nudge",
                            nudge: {
                                nudge_id: "n-keep",
                                kind: "wip_overflow",
                                project_id: "p1",
                                summary: "keep me",
                                target_ids: [],
                                severity: "warn"
                            }
                        }
                    },
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "nudge",
                            nudge: {
                                nudge_id: "n-drop",
                                kind: "stale_task",
                                project_id: "p1",
                                summary: "drop me",
                                target_ids: [],
                                severity: "info"
                            }
                        }
                    }
                ])
            );
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () => useAgent("triage-agent", { projectId: "p1" }),
                { wrapper: wrapper(queryClient) }
            );

            await act(async () => {
                await result.current.start("triage");
            });

            await waitFor(() => {
                expect(result.current.nudges).toHaveLength(2);
            });

            act(() => {
                result.current.dismissNudge("n-drop");
            });

            expect(result.current.nudges.map((n) => n.nudge_id)).toEqual([
                "n-keep"
            ]);
        });

        it("dedups same (kind, project_id) when streamed in the same turn", async () => {
            mockedStream.mockReturnValueOnce(
                fromParts([
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "nudge",
                            nudge: {
                                nudge_id: "old",
                                kind: "wip_overflow",
                                project_id: "p1",
                                summary: "old summary",
                                target_ids: [],
                                severity: "info"
                            }
                        }
                    },
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "nudge",
                            nudge: {
                                nudge_id: "new",
                                kind: "wip_overflow",
                                project_id: "p1",
                                summary: "new summary",
                                target_ids: [],
                                severity: "warn"
                            }
                        }
                    }
                ])
            );
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () => useAgent("triage-agent", { projectId: "p1" }),
                { wrapper: wrapper(queryClient) }
            );

            await act(async () => {
                await result.current.start("triage");
            });

            await waitFor(() => {
                expect(result.current.nudges).toHaveLength(1);
            });
            expect(result.current.nudges[0].nudge_id).toBe("new");
        });
    });
});
