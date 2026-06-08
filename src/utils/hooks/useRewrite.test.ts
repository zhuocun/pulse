import { act, renderHook } from "@testing-library/react";

import environment from "../../constants/env";

import useRewrite from "./useRewrite";

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: { aiUseLocalEngine: true, aiBaseUrl: "" }
}));

interface AgentStub {
    start: jest.Mock;
    abort: jest.Mock;
    state: { messages: { role: string; content: string }[] };
    isStreaming: boolean;
    error: Error | null;
}

let mockAgentReturn: AgentStub;

jest.mock("./useAgent", () => ({
    __esModule: true,
    default: () => mockAgentReturn,
    generateThreadId: () => "thread-test-123"
}));

const makeAgent = (overrides: Partial<AgentStub> = {}): AgentStub => ({
    start: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn(),
    state: { messages: [] },
    isStreaming: false,
    error: null,
    ...overrides
});

describe("useRewrite", () => {
    beforeEach(() => {
        environment.aiUseLocalEngine = true;
        mockAgentReturn = makeAgent();
    });

    it("runs deterministically on the local engine without touching the agent", () => {
        const { result } = renderHook(() => useRewrite("p1"));
        act(() => {
            result.current.run({ mode: "polish", note: "fix it." });
        });
        expect(result.current.result).toBe("Fix it.");
        expect(mockAgentReturn.start).not.toHaveBeenCalled();
        expect(result.current.isStreaming).toBe(false);
    });

    it("returns the trimmed note for translate offline (no model)", () => {
        const { result } = renderHook(() => useRewrite("p1"));
        act(() => {
            result.current.run({
                mode: "translate",
                note: "  hello  ",
                localeName: "Chinese"
            });
        });
        expect(result.current.result).toBe("hello");
    });

    it("streams through the agent on the remote engine with a fresh thread", () => {
        environment.aiUseLocalEngine = false;
        mockAgentReturn = makeAgent({
            state: {
                messages: [
                    { role: "user", content: "prompt" },
                    { role: "assistant", content: "Rewritten note." }
                ]
            }
        });
        const { result } = renderHook(() => useRewrite("p1"));

        // Derives the latest assistant turn as the result.
        expect(result.current.result).toBe("Rewritten note.");

        act(() => {
            result.current.run({ mode: "summarize", note: "long note here" });
        });
        expect(mockAgentReturn.start).toHaveBeenCalledTimes(1);
        const [input, options] = mockAgentReturn.start.mock.calls[0];
        expect(input).toEqual({
            messages: [
                expect.objectContaining({
                    role: "user",
                    content: expect.stringContaining("long note here")
                })
            ]
        });
        expect(options).toEqual({
            threadId: "thread-test-123",
            autonomy: "plan"
        });
    });

    it("ignores assistant turns before the latest user message", () => {
        environment.aiUseLocalEngine = false;
        mockAgentReturn = makeAgent({
            state: {
                messages: [
                    { role: "user", content: "first" },
                    { role: "assistant", content: "old answer" },
                    { role: "user", content: "second" }
                ]
            }
        });
        const { result } = renderHook(() => useRewrite("p1"));
        // No assistant turn after the last user message yet → empty.
        expect(result.current.result).toBe("");
    });

    it("forwards abort to the agent", () => {
        environment.aiUseLocalEngine = false;
        const { result } = renderHook(() => useRewrite("p1"));
        act(() => {
            result.current.abort();
        });
        expect(mockAgentReturn.abort).toHaveBeenCalled();
    });
});
