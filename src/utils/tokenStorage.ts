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
/**
 * `sessionStorage` handoff key. Same tab, in-memory, synchronous — the
 * only one of the three write paths that is reliably readable on iOS
 * Safari Mobile immediately after `window.location.assign(...)`:
 * `localStorage` is disk-backed and commits asynchronously (the next
 * page's read races the flush), and `document.cookie` set via JS can be
 * silently dropped by WebKit's ITP after the document teardown. The
 * sessionStorage entry is mirrored back into `localStorage` on the next
 * read so cross-tab subscribers and a later refresh still find it.
 */
const TOKEN_SESSION_KEY = "TokenSession";

type AuthTokenListener = () => void;
const authTokenListeners = new Set<AuthTokenListener>();
/**
 * Set while the iOS/macOS post-login `nativeNavigate` is in flight.
 * `readAuthToken` returns `null` until the document tears down so any
 * React re-render (Ant Design `message`, query-cache subscribers, etc.)
 * cannot commit `<Navigate replace />` and `history.replaceState` the
 * URL to the assign target before WebKit processes the queued document
 * load. Module state resets on the next full page load.
 */
let loginHardNavPending = false;

export const markLoginHardNavPending = (): void => {
    loginHardNavPending = true;
};

/** Clears the in-flight hard-nav guard — for unit tests only. */
export const resetLoginHardNavPendingForTests = (): void => {
    loginHardNavPending = false;
};

export type AuthTokenWriteStatus = {
    persisted: boolean;
    storage: boolean;
    cookie: boolean;
    session: boolean;
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

const readAuthSessionStorage = (): string | null => {
    const storage = getSessionStorageSafe();
    if (!storage) return null;
    try {
        return storage.getItem(TOKEN_SESSION_KEY);
    } catch {
        return null;
    }
};

const writeAuthSessionStorage = (token: string): boolean => {
    const storage = getSessionStorageSafe();
    if (!storage) return false;
    try {
        storage.setItem(TOKEN_SESSION_KEY, token);
        return storage.getItem(TOKEN_SESSION_KEY) === token;
    } catch {
        return false;
    }
};

const clearAuthSessionStorage = (): void => {
    const storage = getSessionStorageSafe();
    if (!storage) return;
    try {
        storage.removeItem(TOKEN_SESSION_KEY);
    } catch {
        // sessionStorage access can fail in private / restricted modes.
    }
};

/**
 * Read the REST bearer with redundancy across `localStorage`, a
 * same-origin cookie, and a per-tab `sessionStorage` handoff.
 *
 * Why all three: iOS Safari Mobile commits `localStorage.setItem` to its
 * disk-backed store asynchronously. When the login flow follows
 * `setItem` with `window.location.assign("/projects")`, the document
 * tear-down can race the disk flush — the next page's `localStorage`
 * comes up empty and the route guard bounces the user back to `/login`,
 * even though the login succeeded. The cookie covers this for most
 * setups, but WebKit's ITP has been observed to silently drop a
 * JavaScript-set cookie after the document teardown (the write-then-
 * readback check passes, the post-reload `document.cookie` is empty).
 * `sessionStorage` is in-memory per-tab, synchronous, and survives the
 * full-document navigation that login triggers, so it is the most
 * reliable handoff on iOS. The cookie is still useful for tab restores
 * and refresh; `localStorage` is still the primary source so a fresh
 * tab opened later finds the session.
 */
export const readAuthToken = (): string | null => {
    if (loginHardNavPending) return null;
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
    const fromSession = readAuthSessionStorage();
    if (fromSession) {
        // The iOS post-login handoff: localStorage hadn't flushed and
        // the cookie didn't survive teardown, but sessionStorage did.
        // Promote it back into the durable stores so a later refresh
        // (which clears sessionStorage when the tab closes) still works.
        mirrorTokenToLocalStorage(fromSession);
        writeAuthCookie(fromSession);
        return fromSession;
    }
    return null;
};

/**
 * Persist the REST bearer to `localStorage`, a same-origin cookie, and
 * a per-tab `sessionStorage` slot. Success is reported when AT LEAST
 * ONE write path is readable after the write attempt. Safari Mobile
 * private mode and sandboxed iframes can disable any of the three
 * individually; the detailed status lets login decide whether the
 * post-login full-document navigation will be able to recover the
 * token on the next page.
 *
 * `silent: true` skips the in-tab subscriber notification. The login
 * form sets this on iPhone iOS, where the same-tab React re-render
 * that `notifyAuthTokenChanged()` schedules causes `LoginPage` to
 * commit `<Navigate to="/projects" replace />`, whose effect runs
 * `history.replaceState({}, "", "/projects")` between the
 * `window.location.assign("/projects")` call and the browser actually
 * processing the document load. WebKit then observes the URL is
 * already at the assign target and treats the pending navigation as a
 * no-op, leaving the user on the still-mounted login form. Suppressing
 * the notify keeps the React tree on `/login` until the document
 * reload tears it down; the freshly mounted tree on `/projects` reads
 * the token from storage at boot. Cross-tab `storage` events are
 * unaffected — they go through the browser, not this notifier.
 */
export const writeAuthTokenWithStatus = (
    token: string,
    options: { silent?: boolean } = {}
): AuthTokenWriteStatus => {
    let storageOk = false;
    const storage = getLocalStorage();
    if (storage) {
        try {
            storage.setItem(TOKEN_STORAGE_KEY, token);
            storageOk = storage.getItem(TOKEN_STORAGE_KEY) === token;
        } catch {
            // Falls through to the cookie / session paths.
        }
    }
    const cookieOk = writeAuthCookie(token);
    const sessionOk = writeAuthSessionStorage(token);
    const persisted = storageOk || cookieOk || sessionOk;
    if (persisted && !options.silent) {
        notifyAuthTokenChanged();
    }
    return {
        persisted,
        storage: storageOk,
        cookie: cookieOk,
        session: sessionOk
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
    clearAuthSessionStorage();
    clearAiProxyToken();
    notifyAuthTokenChanged();
};
