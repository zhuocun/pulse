/**
 * Build the sessionStorage key for a given (agentName, projectId) pair so
 * LangGraph checkpoint threads survive page refresh.
 */
export const threadStorageKey = (
    agentName: string,
    projectId?: string
): string => `pulse.agentThread.${agentName}.${projectId ?? "none"}`;

/** Read back a persisted thread id. Returns undefined on SSR or storage error. */
export const readPersistedThread = (key: string): string | undefined => {
    if (typeof window === "undefined") return undefined;
    try {
        return sessionStorage.getItem(key) ?? undefined;
    } catch {
        return undefined;
    }
};

/** Write a thread id to sessionStorage. No-ops on SSR or storage errors. */
export const writePersistedThread = (key: string, threadId: string): void => {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(key, threadId);
    } catch {
        // Private-mode / quota exceeded — silently ignore.
    }
};

/** Erase a persisted thread id from sessionStorage. */
export const clearPersistedThreadStorage = (key: string): void => {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
};
