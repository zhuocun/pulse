/**
 * Recursively unwraps common API error shapes (`Error`, string, array,
 * `{ error }` / `{ message }` / `{ msg }` envelopes) and returns the first
 * non-empty message found, or `null` if nothing usable is present.
 *
 * Callers add their own fallback (e.g. `"Operation failed"`,
 * `microcopy.feedback.operationFailed`) so the same traversal can serve
 * both English-only utilities and i18n-aware UI surfaces.
 */
const extractErrorMessage = (error: unknown): string | null => {
    if (error instanceof Error) return error.message || null;
    if (typeof error === "string") return error || null;
    if (Array.isArray(error)) {
        for (const item of error) {
            const found = extractErrorMessage(item);
            if (found) return found;
        }
        return null;
    }
    if (error && typeof error === "object") {
        const {
            error: nestedError,
            message,
            msg
        } = error as {
            error?: unknown;
            message?: unknown;
            msg?: unknown;
        };
        return (
            extractErrorMessage(nestedError) ??
            extractErrorMessage(message) ??
            extractErrorMessage(msg)
        );
    }
    return null;
};

export default extractErrorMessage;
