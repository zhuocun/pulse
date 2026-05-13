const TOKEN_STORAGE_KEY = "Token";
const AI_PROXY_TOKEN_KEY = "AiProxyJwt";

type AuthTokenListener = () => void;
const authTokenListeners = new Set<AuthTokenListener>();

/**
 * Subscribe to REST bearer changes in `localStorage` (login, logout, clear).
 * Used by `useAuth` so React re-renders when the token is written outside of
 * React state — e.g. after `POST /auth/login` persists the JWT before routing
 * to `/projects`. Without this, some WebKit builds only surface the new token
 * on a full reload.
 */
export const subscribeAuthToken = (listener: AuthTokenListener): (() => void) => {
    authTokenListeners.add(listener);
    return () => {
        authTokenListeners.delete(listener);
    };
};

const notifyAuthTokenChanged = (): void => {
    authTokenListeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // Subscriber errors must not break auth storage updates.
        }
    });
};

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
        notifyAuthTokenChanged();
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
    if (storage) {
        try {
            storage.removeItem(TOKEN_STORAGE_KEY);
        } catch {
            // Storage access can fail in private / restricted browser modes.
        }
    }
    clearAiProxyToken();
    notifyAuthTokenChanged();
};
