/**
 * Idempotency key generator for AI requests (PRD v3 §8.4).
 *
 * The BE has a full idempotency middleware that deduplicates concurrent
 * retries on the same logical request. Every AI fetch call must include a
 * fresh `Idempotency-Key` header so the middleware can identify the attempt.
 *
 * A new key is generated on every invocation — callers do NOT cache the
 * key across retry attempts. That way React Query or a manual retry always
 * sends a distinct key, which is what the BE expects for a "new attempt on
 * the same logical operation".
 *
 * `crypto.randomUUID()` is available in all modern browsers (Chrome 92+,
 * Firefox 95+, Safari 15.4+) and in Node 19+. The try/catch fallback to
 * `Math.random()` keeps tests running in older Node/jsdom builds where the
 * polyfill is absent.
 */
export const newIdempotencyKey = (): string => {
    try {
        const cryptoLike = (
            typeof globalThis !== "undefined"
                ? globalThis
                : typeof window !== "undefined"
                  ? window
                  : {}
        ) as { crypto?: { randomUUID?: () => string } };
        if (typeof cryptoLike.crypto?.randomUUID === "function") {
            return cryptoLike.crypto.randomUUID();
        }
    } catch {
        /* fall through to Math.random() */
    }
    // Fallback: 36-char UUID-like string for environments without crypto.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};
