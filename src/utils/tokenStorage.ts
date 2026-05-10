const TOKEN_STORAGE_KEY = "Token";
const AI_PROXY_TOKEN_KEY = "AiProxyJwt";

const getLocalStorage = (): Storage | null => {
    if (typeof globalThis === "undefined") return null;
    try {
        if (!("localStorage" in globalThis)) return null;
        return globalThis.localStorage;
    } catch {
        return null;
    }
};

const getSessionStorageSafe = (): Storage | null => {
    if (typeof globalThis === "undefined") return null;
    try {
        if (!("sessionStorage" in globalThis)) return null;
        return globalThis.sessionStorage;
    } catch {
        return null;
    }
};

export const readAuthToken = (): string | null => {
    const storage = getLocalStorage();
    if (!storage) return null;
    try {
        return storage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
};

export const writeAuthToken = (token: string): boolean => {
    const storage = getLocalStorage();
    if (!storage) return false;
    try {
        storage.setItem(TOKEN_STORAGE_KEY, token);
        return true;
    } catch {
        return false;
    }
};

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

export const clearAuthToken = (): void => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
        storage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // Storage access can fail in private / restricted browser modes.
    }
    clearAiProxyToken();
};
