import {
    clearAiProxyToken,
    clearAuthToken,
    readAiProxyToken,
    readAuthToken,
    subscribeAuthToken,
    writeAiProxyToken,
    writeAuthToken
} from "./tokenStorage";

describe("tokenStorage", () => {
    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
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

    it("stores and clears the AI proxy token", () => {
        expect(writeAiProxyToken("ai-1")).toBe(true);
        expect(readAiProxyToken()).toBe("ai-1");
        clearAiProxyToken();
        expect(readAiProxyToken()).toBeNull();
    });

    it("fails closed when storage access throws", () => {
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

        expect(readAuthToken()).toBeNull();
        expect(writeAuthToken("jwt-1")).toBe(false);
        expect(() => clearAuthToken()).not.toThrow();

        expect(getItemSpy).toHaveBeenCalled();
        expect(setItemSpy).toHaveBeenCalledWith("Token", "jwt-1");
        expect(removeItemSpy).toHaveBeenCalledWith("Token");
    });
});
