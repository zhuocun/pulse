import { getStoredBearerAuthHeader } from "./aiAuthHeader";

describe("getStoredBearerAuthHeader", () => {
    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it("returns Bearer when a token exists", () => {
        localStorage.setItem("Token", "abc");
        expect(getStoredBearerAuthHeader()).toBe("Bearer abc");
    });

    it("prefers the narrow AI proxy token when present", () => {
        localStorage.setItem("Token", "rest-wide");
        sessionStorage.setItem("AiProxyJwt", "narrow-ai");
        expect(getStoredBearerAuthHeader()).toBe("Bearer narrow-ai");
    });

    it("returns an empty string when no token is stored", () => {
        expect(getStoredBearerAuthHeader()).toBe("");
    });

    it("returns an empty string when localStorage is unavailable", () => {
        const original = global.localStorage;
        // @ts-expect-error simulate non-browser environments
        delete global.localStorage;
        expect(getStoredBearerAuthHeader()).toBe("");
        global.localStorage = original;
    });

    it("returns an empty string when reading localStorage throws", () => {
        const originalGetItem = Storage.prototype.getItem;
        jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("denied");
        });

        expect(getStoredBearerAuthHeader()).toBe("");

        Storage.prototype.getItem = originalGetItem;
    });
});
