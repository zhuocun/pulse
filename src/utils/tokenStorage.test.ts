import {
    clearAiProxyToken,
    readAiProxyToken,
    writeAiProxyToken
} from "./tokenStorage";

describe("tokenStorage (AI proxy bearer)", () => {
    afterEach(() => {
        sessionStorage.clear();
        jest.restoreAllMocks();
    });

    it("stores and clears the AI proxy token", () => {
        expect(readAiProxyToken()).toBeNull();
        expect(writeAiProxyToken("ai-1")).toBe(true);
        expect(readAiProxyToken()).toBe("ai-1");
        clearAiProxyToken();
        expect(readAiProxyToken()).toBeNull();
    });

    it("returns null when sessionStorage access throws", () => {
        // Safari private-browsing mode and some sandboxed contexts let
        // ``sessionStorage`` reads throw rather than return a benign
        // null. The helper must report "no token" rather than crash
        // the consumer.
        jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(readAiProxyToken()).toBeNull();
    });

    it("reports failure when sessionStorage writes throw", () => {
        jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(writeAiProxyToken("ai-1")).toBe(false);
    });

    it("does not throw when clearing fails", () => {
        jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(() => clearAiProxyToken()).not.toThrow();
    });
});
