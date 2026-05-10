import type { StreamPart } from "../../interfaces/agent";
import { forEachAgentStreamPart } from "./useAgentStreamConsumer";

function emptyStream(): AsyncIterable<StreamPart> {
    return {
        [Symbol.asyncIterator]: () => ({
            next: (): Promise<IteratorResult<StreamPart>> =>
                Promise.resolve({ done: true, value: undefined })
        })
    };
}

describe("forEachAgentStreamPart", () => {
    it("invokes arm / clear watchdog around the iterator", async () => {
        const arms: string[] = [];
        const ac = new AbortController();
        const { pendingResume, streamFailed } = await forEachAgentStreamPart(
            emptyStream(),
            {
                signal: ac.signal,
                armWatchdog: () => arms.push("arm"),
                clearWatchdog: () => arms.push("clear"),
                onPart: async () => ({ kind: "continue" })
            }
        );
        expect(pendingResume).toBeUndefined();
        expect(streamFailed).toBe(false);
        expect(arms).toEqual(["arm", "clear"]);
    });
});
