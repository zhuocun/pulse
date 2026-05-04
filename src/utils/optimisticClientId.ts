/**
 * Client-only ids for optimistic rows before the server assigns `_id`.
 * Legacy caches may still use the literal `"mock"`; new rows use `tmp-…`
 * so concurrent creates never collide.
 */
export const createOptimisticClientId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `tmp-${crypto.randomUUID()}`
        : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const isOptimisticPlaceholderId = (
    id: string | null | undefined
): boolean => Boolean(id && (id === "mock" || id.startsWith("tmp-")));
