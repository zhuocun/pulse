const AI_PROXY_TOKEN_KEY = "AiProxyJwt";

const getSessionStorageSafe = (): Storage | null => {
    if (typeof globalThis === "undefined") return null;
    try {
        if (!("sessionStorage" in globalThis)) return null;
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
};

/**
 * Read the narrow-scope (``scp=ai_proxy``) bearer used for AI calls.
 *
 * The REST JWT used to live alongside this one, persisted in
 * ``localStorage`` / a JS-set cookie / ``sessionStorage`` so the FE
 * could attach it as ``Authorization: Bearer …`` on every same-origin
 * request. On iOS Safari 26.5 that handoff was racing WebKit's ITP
 * (cookies silently dropped after teardown) and its async
 * ``localStorage`` flush (next document reads empty). ``POST
 * /auth/login`` now writes the REST JWT into an HttpOnly cookie that
 * the browser carries automatically -- JS cannot read it, and the
 * iOS-specific handoff is no longer reachable. The AI proxy stays
 * here because its endpoint can live on a different origin from the
 * cookie's host, so it still needs an explicit bearer header.
 */
export const readAiProxyToken = (): string | null => {
    const storage = getSessionStorageSafe();
    if (!storage) return null;
    try {
        return storage.getItem(AI_PROXY_TOKEN_KEY);
    } catch {
        return null;
    }
};

export const writeAiProxyToken = (token: string): boolean => {
    const storage = getSessionStorageSafe();
    if (!storage) return false;
    try {
        storage.setItem(AI_PROXY_TOKEN_KEY, token);
        return true;
    } catch {
        return false;
    }
};

export const clearAiProxyToken = (): void => {
    const storage = getSessionStorageSafe();
    if (!storage) return;
    try {
        storage.removeItem(AI_PROXY_TOKEN_KEY);
    } catch {
        // sessionStorage access can fail in private / restricted modes.
    }
};
