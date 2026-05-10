import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

import type {
    AgentStreamRequest,
    InterruptPayload
} from "../../interfaces/agent";
import type { FeToolContext } from "../ai/feTools";
import useAgentToolResolver from "./useAgentToolResolver";

const baseRequest: AgentStreamRequest = {
    input: { messages: [] },
    config: { configurable: { thread_id: "t_1", project_id: "p1" } },
    stream_mode: ["updates", "messages", "custom"],
    version: "v2"
};

const makeContext = (): FeToolContext => ({
    queryClient: new QueryClient(),
    projectId: "p1",
    userId: "u1",
    autonomyLevel: "plan"
});

const makeInterrupt = (tool: string): InterruptPayload => ({
    tool,
    args: { query: "value" }
});

describe("useAgentToolResolver", () => {
    it("resolves known FE tool interrupts and returns the resume payload", async () => {
        const run = jest.fn().mockResolvedValue({ ok: true });
        const { result } = renderHook(() => useAgentToolResolver());

        let resumeValue: unknown;
        await act(async () => {
            resumeValue = await result.current.resolveInterrupt({
                registry: {
                    "fe.echo": { name: "fe.echo", description: "echo", run }
                },
                autoResume: true,
                autonomy: "plan",
                threadId: "t_1",
                lastInterrupt: null,
                interrupt: makeInterrupt("fe.echo"),
                ctx: makeContext()
            });
        });

        expect(run).toHaveBeenCalledTimes(1);
        expect(resumeValue).toEqual({ ok: true });
        expect(result.current.status).toBe("idle");
        expect(result.current.error).toBeNull();
    });

    it("returns an error envelope when FE tool resolution throws", async () => {
        const { result } = renderHook(() => useAgentToolResolver());

        let resumeValue: unknown;
        await act(async () => {
            resumeValue = await result.current.resolveInterrupt({
                registry: {
                    "fe.fail": {
                        name: "fe.fail",
                        description: "fail",
                        run: () => {
                            throw new Error("tool exploded");
                        }
                    }
                },
                autoResume: true,
                autonomy: "plan",
                threadId: "t_1",
                lastInterrupt: makeInterrupt("fe.prior"),
                interrupt: makeInterrupt("fe.fail"),
                ctx: makeContext()
            });
        });

        expect(resumeValue).toEqual({ error: "tool exploded" });
        expect(result.current.status).toBe("error");
        expect(result.current.error?.message).toBe("tool exploded");
    });

    it("runs the auto-resume loop and threads resume commands into subsequent rounds", async () => {
        const consumeStreamRound = jest
            .fn()
            .mockResolvedValueOnce({
                pendingResume: { rows: [] },
                streamFailed: false
            })
            .mockResolvedValueOnce({
                pendingResume: undefined,
                streamFailed: false
            });
        const onAutoResumeApplied = jest.fn();
        const { result } = renderHook(() => useAgentToolResolver());

        let loopResult: Awaited<
            ReturnType<typeof result.current.runAutoResumeLoop>
        >;
        await act(async () => {
            loopResult = await result.current.runAutoResumeLoop({
                initialBody: baseRequest,
                consumeStreamRound,
                onAutoResumeApplied
            });
        });

        expect(consumeStreamRound).toHaveBeenCalledTimes(2);
        expect(consumeStreamRound.mock.calls[1][0].command?.resume).toEqual({
            rows: []
        });
        expect(onAutoResumeApplied).toHaveBeenCalledTimes(1);
        expect(loopResult!).toEqual({
            turnErrored: false,
            loopExhausted: false
        });
    });

    it("marks the loop as exhausted when all 8 rounds request resume", async () => {
        const consumeStreamRound = jest.fn().mockResolvedValue({
            pendingResume: { keepGoing: true },
            streamFailed: false
        });
        const { result } = renderHook(() => useAgentToolResolver());

        let loopResult: Awaited<
            ReturnType<typeof result.current.runAutoResumeLoop>
        >;
        await act(async () => {
            loopResult = await result.current.runAutoResumeLoop({
                initialBody: baseRequest,
                consumeStreamRound,
                onAutoResumeApplied: jest.fn()
            });
        });

        expect(consumeStreamRound).toHaveBeenCalledTimes(8);
        expect(loopResult!).toEqual({
            turnErrored: false,
            loopExhausted: true
        });
    });
});
