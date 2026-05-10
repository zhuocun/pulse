import type { StreamPart } from "../../interfaces/agent";

export type StreamPartHandlerResult =
    | { kind: "continue" }
    | {
          kind: "stop";
          pendingResume?: unknown;
          streamFailed?: boolean;
      };

/**
 * Shared SSE consumption loop for `useAgent` (keeps stream-agent wiring in one place).
 */
export async function forEachAgentStreamPart(
    source: AsyncIterable<StreamPart>,
    options: {
        signal: AbortSignal;
        armWatchdog: () => void;
        clearWatchdog: () => void;
        onPart: (part: StreamPart) => Promise<StreamPartHandlerResult>;
        onNonAbortTransportError?: (err: unknown) => void;
    }
): Promise<{ pendingResume: unknown | undefined; streamFailed: boolean }> {
    let pendingResume: unknown | undefined;
    let terminatedByStreamError = false;
    options.armWatchdog();
    try {
        for await (const part of source) {
            if (options.signal.aborted) break;
            options.armWatchdog();
            const r = await options.onPart(part);
            if (r.kind === "stop") {
                pendingResume = r.pendingResume;
                terminatedByStreamError = r.streamFailed ?? false;
                break;
            }
        }
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return { pendingResume: undefined, streamFailed: false };
        }
        options.onNonAbortTransportError?.(err);
        return { pendingResume: undefined, streamFailed: true };
    } finally {
        options.clearWatchdog();
    }
    if (terminatedByStreamError) {
        return { pendingResume: undefined, streamFailed: true };
    }
    return { pendingResume, streamFailed: false };
}
