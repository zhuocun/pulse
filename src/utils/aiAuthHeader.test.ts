import { getStoredBearerAuthHeader } from "./aiAuthHeader";

describe("getStoredBearerAuthHeader", () => {
    afterEach(() => {
        sessionStorage.clear();
    });

    it("returns Bearer when the narrow AI proxy token is present", () => {
        sessionStorage.setItem("AiProxyJwt", "narrow-ai");
        expect(getStoredBearerAuthHeader()).toBe("Bearer narrow-ai");
    });

    it("returns an empty string when the AI proxy token is absent", () => {
        // The REST JWT is no longer JS-readable -- it lives in an
        // HttpOnly cookie -- so AI calls that need an explicit bearer
        // must fall through to "no auth" rather than a stale fallback.
        expect(getStoredBearerAuthHeader()).toBe("");
    });

    it("returns an empty string when reading sessionStorage throws", () => {
        jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("denied");
        });

        expect(getStoredBearerAuthHeader()).toBe("");
    });
});
