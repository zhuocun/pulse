import {
    clearAuthToken,
    readAuthToken,
    writeAuthToken
} from "./tokenStorage";

describe("tokenStorage", () => {
    afterEach(() => {
        localStorage.clear();
        jest.restoreAllMocks();
    });

    it("reads, writes, and clears the auth token", () => {
        expect(readAuthToken()).toBeNull();
        expect(writeAuthToken("jwt-1")).toBe(true);
        expect(readAuthToken()).toBe("jwt-1");

        clearAuthToken();

        expect(readAuthToken()).toBeNull();
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
