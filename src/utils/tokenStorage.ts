const TOKEN_STORAGE_KEY = "Token";
const AI_PROXY_TOKEN_KEY = "AiProxyJwt";
/**
 * Cookie name MUST match `TOKEN_STORAGE_KEY` value-for-value so the auth
 * cookie can be cleared by name from network tooling and so test
 * coverage of either spelling lines up. The cookie is a same-origin,
 * non-HttpOnly, `SameSite=Lax`, `Path=/` JWT mirror of the localStorage
 * entry — see `writeAuthToken` for rationale.
 */
const TOKEN_COOKIE_NAME = TOKEN_STORAGE_KEY;
const TOKEN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

type AuthTokenListener = () => void;
const authTokenListeners = new Set<AuthTokenListener>();

export type AuthTokenWriteStatus = {
    persisted: boolean;
    storage: boolean;
    cookie: boolean;
};

/**
 * Subscribe to REST bearer changes in `localStorage` (login, logout, clear).
 * Used by `useAuth` so React re-renders when the token is written outside of
 * React state — e.g. after `POST /auth/login` persists the JWT before routing
 * to `/projects`. Without this, some WebKit builds only surface the new token
 * on a full reload.
 */
export const subscribeAuthToken = (
    listener: AuthTokenListener
): (() => void) => {
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

const getDocumentSafe = (): Document | null => {
    if (typeof document === "undefined") return null;
    try {
        // Touching `document.cookie` throws in some sandboxed contexts
        // (sandboxed iframes without `allow-same-origin`). Probe first so
        // callers can fall through to the storage path silently.
        void document.cookie;
        return document;
    } catch {
        return null;
    }
};

const readAuthCookie = (): string | null => {
    const doc = getDocumentSafe();
    if (!doc) return null;
    try {
        const raw = doc.cookie;
        if (!raw) return null;
        const prefix = `${TOKEN_COOKIE_NAME}=`;
        // Cookies are joined with "; ". Iterate so we don't accidentally
        // match a substring of another cookie value that happens to
        // contain our key as a prefix (e.g. an analytics cookie that
        // stores `Tokenized=…`).
        for (const part of raw.split(";")) {
            const trimmed = part.trim();
            if (trimmed.startsWith(prefix)) {
                const value = trimmed.slice(prefix.length);
                if (!value) return null;
                try {
                    return decodeURIComponent(value);
                } catch {
                    return value;
                }
            }
        }
        return null;
    } catch {
        return null;
    }
};

const writeAuthCookie = (token: string): boolean => {
    const doc = getDocumentSafe();
    if (!doc) return false;
    try {
        const encoded = encodeURIComponent(token);
        const isSecureContext =
            typeof window !== "undefined" &&
            window.location?.protocol === "https:";
        const attrs = [
            `${TOKEN_COOKIE_NAME}=${encoded}`,
            "Path=/",
            `Max-Age=${TOKEN_COOKIE_MAX_AGE_SECONDS}`,
            "SameSite=Lax"
        ];
        if (isSecureContext) attrs.push("Secure");
        doc.cookie = attrs.join("; ");
        return readAuthCookie() === token;
    } catch {
        return false;
    }
};

const clearAuthCookie = (): void => {
    const doc = getDocumentSafe();
    if (!doc) return;
    try {
        const isSecureContext =
            typeof window !== "undefined" &&
            window.location?.protocol === "https:";
        const attrs = [
            `${TOKEN_COOKIE_NAME}=`,
            "Path=/",
            "Max-Age=0",
            "SameSite=Lax"
        ];
        if (isSecureContext) attrs.push("Secure");
        doc.cookie = attrs.join("; ");
    } catch {
        // Cookie access can fail in sandboxed / restricted contexts.
    }
};

const mirrorTokenToLocalStorage = (token: string): void => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
        // Only write if the storage doesn't already hold the same value,
        // so the self-heal path doesn't churn the storage event listeners
        // on every read.
        if (storage.getItem(TOKEN_STORAGE_KEY) === token) return;
        storage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
        // Storage may be unavailable — the cookie alone is enough to
        // keep the session alive for this request.
    }
};

/**
 * Read the REST bearer with redundancy across `localStorage` and a
 * same-origin cookie.
 *
 * Why both: iOS Safari Mobile commits `localStorage.setItem` to its
 * disk-backed store asynchronously. When the login flow follows
 * `setItem` with `window.location.assign("/projects")`, the document
 * tear-down can race the disk flush — the next page's `localStorage`
 * comes up empty and the route guard bounces the user back to `/login`,
 * even though the login succeeded. The cookie write is durable across
 * the same navigation, so we mirror the token there and self-heal the
 * `localStorage` entry on the next read. The cookie is `Path=/`,
 * `SameSite=Lax`, `Secure` on https, with a 24h `Max-Age` matching the
 * JWT expiry.
 */
export const readAuthToken = (): string | null => {
    const fromStorage = (() => {
        const storage = getLocalStorage();
        if (!storage) return null;
        try {
            return storage.getItem(TOKEN_STORAGE_KEY);
        } catch {
            return null;
        }
    })();
    if (fromStorage) return fromStorage;
    const fromCookie = readAuthCookie();
    if (fromCookie) {
        // Self-heal: hand the value back to `localStorage` so subsequent
        // reads (and `useSyncExternalStore` subscribers across other
        // tabs / contexts) see a consistent source of truth.
        mirrorTokenToLocalStorage(fromCookie);
        return fromCookie;
    }
    return null;
};

/**
 * Persist the REST bearer to both `localStorage` and a same-origin
 * cookie. Success is reported when AT LEAST ONE write path is readable
 * after the write attempt. Safari Mobile private mode and sandboxed
 * iframes can disable either mechanism individually; the detailed status
 * lets login avoid full document navigation when only localStorage is
 * available.
 */
export const writeAuthTokenWithStatus = (
    token: string
): AuthTokenWriteStatus => {
    let storageOk = false;
    const storage = getLocalStorage();
    if (storage) {
        try {
            storage.setItem(TOKEN_STORAGE_KEY, token);
            storageOk = true;
        } catch {
            // Falls through to the cookie path.
        }
    }
    const cookieOk = writeAuthCookie(token);
    const persisted = storageOk || cookieOk;
    if (persisted) {
        notifyAuthTokenChanged();
    }
    return {
        persisted,
        storage: storageOk,
        cookie: cookieOk
    };
};

export const writeAuthToken = (token: string): boolean =>
    writeAuthTokenWithStatus(token).persisted;

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
    clearAuthCookie();
    clearAiProxyToken();
    notifyAuthTokenChanged();
};
