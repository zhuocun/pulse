import {
    clearAiProxyToken,
    clearAuthToken,
    readAiProxyToken,
    readAuthToken,
    subscribeAuthToken,
    writeAiProxyToken,
    writeAuthToken,
    writeAuthTokenWithStatus
} from "./tokenStorage";

const clearAllCookies = (): void => {
    if (typeof document === "undefined") return;
    for (const part of document.cookie.split(";")) {
        const name = part.split("=")[0]?.trim();
        if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
};

describe("tokenStorage", () => {
    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        clearAllCookies();
        jest.restoreAllMocks();
    });

    it("notifies auth-token subscribers on write and clear", () => {
        const listener = jest.fn();
        const unsub = subscribeAuthToken(listener);

        expect(writeAuthToken("jwt-1")).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);

        listener.mockClear();
        clearAuthToken();
        expect(listener).toHaveBeenCalledTimes(1);

        listener.mockClear();
        unsub();
        expect(writeAuthToken("jwt-2")).toBe(true);
        expect(listener).not.toHaveBeenCalled();
    });

    it("reads, writes, and clears the auth token", () => {
        expect(readAuthToken()).toBeNull();
        expect(writeAuthToken("jwt-1")).toBe(true);
        expect(readAuthToken()).toBe("jwt-1");

        clearAuthToken();

        expect(readAuthToken()).toBeNull();
        expect(readAiProxyToken()).toBeNull();
    });

    it("mirrors the token into a same-origin cookie so it survives a Safari Mobile reload", () => {
        writeAuthToken("jwt-1");
        expect(document.cookie).toContain("Token=jwt-1");

        clearAuthToken();
        expect(document.cookie).not.toContain("Token=jwt-1");
    });

    it("falls back to the cookie when localStorage is empty after a navigation", () => {
        // Simulate the iOS Safari Mobile failure mode: the cookie write
        // landed before `window.location.assign("/projects")` tore down
        // the document, but the localStorage disk flush did not. The
        // next page sees an empty localStorage yet must still resolve
        // the JWT and stay logged in.
        document.cookie = "Token=jwt-from-cookie; Path=/";
        expect(localStorage.getItem("Token")).toBeNull();

        expect(readAuthToken()).toBe("jwt-from-cookie");
        // Self-heal — subsequent reads come from localStorage so the
        // useSyncExternalStore subscribers don't keep re-running the
        // cookie parse on every render.
        expect(localStorage.getItem("Token")).toBe("jwt-from-cookie");
    });

    it("URL-decodes cookie-encoded JWTs", () => {
        // JWTs are base64url-safe so this is defence-in-depth, but
        // matches `encodeURIComponent` on the write side.
        document.cookie = `Token=${encodeURIComponent("a.b.c+d/e=")}; Path=/`;

        expect(readAuthToken()).toBe("a.b.c+d/e=");
    });

    it("stores and clears the AI proxy token", () => {
        expect(writeAiProxyToken("ai-1")).toBe(true);
        expect(readAiProxyToken()).toBe("ai-1");
        clearAiProxyToken();
        expect(readAiProxyToken()).toBeNull();
    });

    it("still persists via cookie when localStorage writes throw", () => {
        // Safari Mobile in some private-mode configurations lets
        // `localStorage.setItem` throw or silently no-op while
        // `document.cookie` continues to work. The login flow must not
        // refuse to navigate in that case — the cookie keeps the user
        // signed in across the post-login reload.
        const setItemSpy = jest
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });

        expect(writeAuthToken("jwt-1")).toBe(true);
        expect(document.cookie).toContain("Token=jwt-1");
        // localStorage was the throwing path, but the read self-heals
        // off the cookie value once the spy is restored.
        setItemSpy.mockRestore();
        expect(readAuthToken()).toBe("jwt-1");
    });

    it("does not report persistence when the cookie write is silently ignored", () => {
        const setItemSpy = jest
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        const cookieDescriptor = Object.getOwnPropertyDescriptor(
            Document.prototype,
            "cookie"
        );
        Object.defineProperty(document, "cookie", {
            configurable: true,
            get() {
                return "";
            },
            set() {
                // Safari/WebKit can accept the assignment syntax but leave no
                // readable cookie when storage policy rejects it.
            }
        });

        try {
            expect(writeAuthToken("jwt-1")).toBe(false);
            expect(readAuthToken()).toBeNull();
            expect(setItemSpy).toHaveBeenCalledWith("Token", "jwt-1");
        } finally {
            if (cookieDescriptor) {
                Object.defineProperty(document, "cookie", cookieDescriptor);
            } else {
                delete (document as unknown as { cookie?: string }).cookie;
            }
            setItemSpy.mockRestore();
        }
    });

    it("reports when the cookie mirror is unavailable despite a localStorage write", () => {
        const cookieDescriptor = Object.getOwnPropertyDescriptor(
            Document.prototype,
            "cookie"
        );
        Object.defineProperty(document, "cookie", {
            configurable: true,
            get() {
                return "";
            },
            set() {
                // Simulates a browser policy that silently drops cookie writes.
            }
        });

        try {
            expect(writeAuthTokenWithStatus("jwt-1")).toEqual({
                persisted: true,
                storage: true,
                cookie: false
            });
            expect(readAuthToken()).toBe("jwt-1");

            localStorage.clear();
            expect(readAuthToken()).toBeNull();
        } finally {
            if (cookieDescriptor) {
                Object.defineProperty(document, "cookie", cookieDescriptor);
            } else {
                delete (document as unknown as { cookie?: string }).cookie;
            }
        }
    });

    it("fails closed when both storage and cookie access are blocked", () => {
        const getItemSpy = jest
            .spyOn(Storage.prototype, "getItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        const setItemSpy = jest
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        const removeItemSpy = jest
            .spyOn(Storage.prototype, "removeItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        // Block the cookie path too — sandboxed iframes (sandbox without
        // `allow-same-origin`) raise SecurityError on `document.cookie`.
        const cookieDescriptor = Object.getOwnPropertyDescriptor(
            Document.prototype,
            "cookie"
        );
        Object.defineProperty(document, "cookie", {
            configurable: true,
            get() {
                throw new Error("blocked");
            },
            set() {
                throw new Error("blocked");
            }
        });

        try {
            expect(readAuthToken()).toBeNull();
            expect(writeAuthToken("jwt-1")).toBe(false);
            expect(() => clearAuthToken()).not.toThrow();

            expect(getItemSpy).toHaveBeenCalled();
            expect(setItemSpy).toHaveBeenCalledWith("Token", "jwt-1");
            expect(removeItemSpy).toHaveBeenCalledWith("Token");
        } finally {
            if (cookieDescriptor) {
                Object.defineProperty(document, "cookie", cookieDescriptor);
            } else {
                // jsdom defines the cookie property on Document.prototype,
                // so removing the per-instance override restores it.
                delete (document as unknown as { cookie?: string }).cookie;
            }
        }
    });
});
