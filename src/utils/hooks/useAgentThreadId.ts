/**
 * Per-turn thread id. Uses `crypto.randomUUID()` when available (modern
 * browsers, Node 19+) and falls back to a `Math.random()` blend for SSR
 * shells / older runtimes that strip `crypto`. Exported so tests can
 * stub it without monkey-patching the global.
 */
export const generateThreadId = (): string => {
    const cryptoLike =
        typeof globalThis !== "undefined"
            ? (
                  globalThis as {
                      crypto?: { randomUUID?: () => string };
                  }
              ).crypto
            : undefined;
    if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
        return `t_${cryptoLike.randomUUID()}`;
    }
    return `t_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
};

/** TTFT SLO threshold in ms (P2-I). Turns exceeding this emit AGENT_TTFT_SLOW. */
export const TTFT_SLO_MS = 1500;
