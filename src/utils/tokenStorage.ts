const TOKEN_STORAGE_KEY = "Token";

const getStorage = (): Storage | null => {
    if (typeof globalThis === "undefined") return null;
    try {
        if (!("localStorage" in globalThis)) return null;
        return globalThis.localStorage;
    } catch {
        return null;
    }
};

export const readAuthToken = (): string | null => {
    const storage = getStorage();
    if (!storage) return null;
    try {
        return storage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
};

export const writeAuthToken = (token: string): boolean => {
    const storage = getStorage();
    if (!storage) return false;
    try {
        storage.setItem(TOKEN_STORAGE_KEY, token);
        return true;
    } catch {
        return false;
    }
};

export const clearAuthToken = (): void => {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // Storage access can fail in private / restricted browser modes.
    }
};
