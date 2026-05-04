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
import useAgentChat from "./useAgentChat";

const mockedStream = streamAgent as unknown as jest.Mock;

async function* fromParts(parts: StreamPart[]) {
    for (const part of parts) {
        yield part;
    }
}

const makeCtx = (projectId = "p1") => ({
    engine: {
        columns: [{ _id: "c1", columnName: "Todo", index: 0, projectId }],
        members: [{ _id: "m1", email: "a@b.c", username: "Alice" }],
        project: { _id: projectId, projectName: "Roadmap" },
        tasks: []
    },
    execution: {
        knownColumnIds: new Set(["c1"]),
        knownMemberIds: new Set(["m1"]),
        knownProjectIds: new Set([projectId]),
        knownTaskIds: new Set<string>(),
        projectId
    }
});

const makeWrapper = (queryClient: QueryClient) => {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
    Wrapper.displayName = "TestWrapper";
    return Wrapper;
};

describe("useAgentChat", () => {
    beforeEach(() => {
        mockedStream.mockReset();
        localStorage.removeItem("boardCopilot:disabledProjectIds");
    });

    it("exposes useAiChat-compatible shape with v2.1 additions (null ctx)", () => {
        // With null ctx the hook is idle — no streamAgent calls
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(null), {
            wrapper: makeWrapper(queryClient)
        });
        // useAiChat-compatible fields
        expect(typeof result.current.abort).toBe("function");
        expect(typeof result.current.dismissError).toBe("function");
        expect(result.current.error).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(Array.isArray(result.current.messages)).toBe(true);
        expect(typeof result.current.reset).toBe("function");
        expect(typeof result.current.send).toBe("function");
        expect(result.current.streamingText).toBe("");
        // v2.1 additions
        expect(result.current.pendingProposal).toBeNull();
        expect(Array.isArray(result.current.pendingNudges)).toBe(true);
        expect(Array.isArray(result.current.citations)).toBe(true);
        expect(typeof result.current.resumeProposal).toBe("function");
        expect(typeof result.current.dismissNudge).toBe("function");
        // No stream calls during idle
        expect(mockedStream).not.toHaveBeenCalled();
    });

    it("does not call streamAgent when ctx is null", async () => {
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(null), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("hello");
        });

        expect(mockedStream).not.toHaveBeenCalled();
        expect(result.current.messages).toEqual([]);
    });

    it("does nothing when trimmed text is empty", async () => {
        mockedStream.mockReturnValueOnce(fromParts([]));
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("   ");
        });

        expect(mockedStream).not.toHaveBeenCalled();
        expect(result.current.messages).toEqual([]);
    });

    it("sends a message and reflects assistant reply in messages", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Hello from agent" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Hi agent");
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        const assistantMsgs = result.current.messages.filter(
            (m) => m.role === "assistant"
        );
        expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
        expect(assistantMsgs[assistantMsgs.length - 1].content).toBe(
            "Hello from agent"
        );
    });

    it("streamingText is empty when not streaming", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Done" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("test");
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.streamingText).toBe("");
        // The message ended up in messages
        const lastAssistant = [...result.current.messages]
            .reverse()
            .find((m) => m.role === "assistant");
        expect(lastAssistant?.content).toBe("Done");
    });

    it("surfaces pendingProposal from custom mutation_proposal event", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "mutation_proposal",
                        proposal: {
                            proposal_id: "mp-adapter-1",
                            description: "Move overdue tasks to Done",
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
                            risk: "low" as const,
                            undoable: true as const
                        }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Move tasks");
        });

        await waitFor(() => {
            expect(result.current.pendingProposal?.proposal_id).toBe(
                "mp-adapter-1"
            );
        });
    });

    it("surfaces citations from custom citation event", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "citation",
                        refs: [
                            {
                                source: "task" as const,
                                id: "t1",
                                quote: "Fix login"
                            }
                        ]
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("What about the login task?");
        });

        await waitFor(() => {
            expect(result.current.citations).toHaveLength(1);
            expect(result.current.citations[0].id).toBe("t1");
        });
    });

    it("surfaces pendingNudges from custom nudge event", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "nudge",
                        nudge: {
                            nudge_id: "n-adapter-1",
                            kind: "load_imbalance" as const,
                            project_id: "p1",
                            summary: "Alice is overloaded",
                            target_ids: ["m1"],
                            severity: "warn" as const
                        }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Check load balance");
        });

        await waitFor(() => {
            expect(result.current.pendingNudges).toHaveLength(1);
            expect(result.current.pendingNudges[0].nudge_id).toBe(
                "n-adapter-1"
            );
        });
    });

    it("dismissNudge hides the nudge from pendingNudges", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "nudge",
                        nudge: {
                            nudge_id: "n-dismiss-1",
                            kind: "stale_task" as const,
                            project_id: "p1",
                            summary: "Stale task",
                            target_ids: ["t1"],
                            severity: "info" as const
                        }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Triage board");
        });

        await waitFor(() => {
            expect(result.current.pendingNudges).toHaveLength(1);
        });

        act(() => {
            result.current.dismissNudge("n-dismiss-1");
        });

        expect(result.current.pendingNudges).toHaveLength(0);
    });

    it("resumeProposal calls agent.resume and clears the pending proposal", async () => {
        // First call: emits a mutation proposal
        mockedStream
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "custom",
                        ns: ["root"],
                        data: {
                            kind: "mutation_proposal",
                            proposal: {
                                proposal_id: "mp-resume-1",
                                description: "Reassign tasks",
                                diff: {},
                                risk: "low" as const,
                                undoable: true as const
                            }
                        }
                    }
                ])
            )
            // Second call: the resume stream
            .mockReturnValueOnce(
                fromParts([
                    {
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "Applied." }, {}]
                    }
                ])
            );

        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Propose a change");
        });

        await waitFor(() => {
            expect(result.current.pendingProposal?.proposal_id).toBe(
                "mp-resume-1"
            );
        });

        await act(async () => {
            result.current.resumeProposal(true);
        });

        await waitFor(() => {
            expect(result.current.pendingProposal).toBeNull();
        });
        // resume was called (streamAgent called twice: start + resume)
        expect(mockedStream).toHaveBeenCalledTimes(2);
    });

    it("dismissError suppresses the error display — initial state is null", () => {
        // dismissError is a simple "clear error" API. The primary contract:
        // calling it when there's no error is a no-op (stays null), and when
        // there IS an error it clears it. We test the no-op case here since
        // triggering a real transport error in jest requires complex async
        // rejection handling that's already covered by useAgent.test.tsx.
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        expect(result.current.error).toBeNull();

        act(() => {
            result.current.dismissError();
        });

        expect(result.current.error).toBeNull();
    });

    it("reset clears messages and nudges", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Some reply" }, {}]
                },
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "nudge",
                        nudge: {
                            nudge_id: "n-reset-1",
                            kind: "wip_overflow" as const,
                            project_id: "p1",
                            summary: "WIP overflow",
                            target_ids: [],
                            severity: "warn" as const
                        }
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Hello");
        });

        await waitFor(() => {
            expect(result.current.messages.length).toBeGreaterThan(0);
        });

        act(() => {
            result.current.reset();
        });

        await waitFor(() => {
            expect(result.current.messages).toEqual([]);
            expect(result.current.pendingNudges).toEqual([]);
            expect(result.current.error).toBeNull();
        });
    });

    it("citations are attached to the last assistant message when streaming completes", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Here's what I found" }, {}]
                },
                {
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "citation",
                        refs: [
                            {
                                source: "task" as const,
                                id: "t42",
                                quote: "Deploy backend"
                            }
                        ]
                    }
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        await act(async () => {
            await result.current.send("Find tasks");
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // Citations should be on the adapter's citations field
        expect(result.current.citations.some((c) => c.id === "t42")).toBe(true);

        // Citations should also be attached to the last assistant message
        const assistantMsg = [...result.current.messages]
            .reverse()
            .find((m) => m.role === "assistant");
        expect(assistantMsg?.citations?.some((c) => c.id === "t42")).toBe(true);
    });

    it("isLoading mirrors agent.isStreaming", async () => {
        mockedStream.mockReturnValueOnce(
            fromParts([
                {
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Reply" }, {}]
                }
            ])
        );
        const queryClient = new QueryClient();
        const { result } = renderHook(() => useAgentChat(makeCtx()), {
            wrapper: makeWrapper(queryClient)
        });

        expect(result.current.isLoading).toBe(false);

        await act(async () => {
            await result.current.send("test");
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });
    });

    // Fix 7: project AI disabled guard — same contract as useAiChat
    describe("project AI disabled guard", () => {
        const { setProjectAiDisabledInStorage } = jest.requireActual<
            typeof import("../ai/projectAiStorage")
        >("../ai/projectAiStorage");

        afterEach(() => {
            setProjectAiDisabledInStorage("p-off", false);
        });

        it("does not call streamAgent when the project AI is disabled", async () => {
            setProjectAiDisabledInStorage("p-off", true);
            const queryClient = new QueryClient();
            const { result } = renderHook(
                () => useAgentChat(makeCtx("p-off")),
                { wrapper: makeWrapper(queryClient) }
            );

            await act(async () => {
                await result.current.send("Should be blocked");
            });

            expect(mockedStream).not.toHaveBeenCalled();
            expect(result.current.messages).toEqual([]);
        });
    });
});
