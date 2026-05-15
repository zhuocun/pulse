import extractErrorMessage from "./extractErrorMessage";

describe("extractErrorMessage", () => {
    it("returns the message of an Error instance", () => {
        expect(extractErrorMessage(new Error("Boom"))).toBe("Boom");
    });

    it("returns null for an Error with an empty message", () => {
        expect(extractErrorMessage(new Error())).toBeNull();
    });

    it("returns strings as-is and null for empty strings", () => {
        expect(extractErrorMessage("Permission denied")).toBe(
            "Permission denied"
        );
        expect(extractErrorMessage("")).toBeNull();
    });

    it("returns null for null, undefined, and primitive non-strings", () => {
        expect(extractErrorMessage(null)).toBeNull();
        expect(extractErrorMessage(undefined)).toBeNull();
        expect(extractErrorMessage(42)).toBeNull();
        expect(extractErrorMessage(true)).toBeNull();
    });

    it("recurses into arrays and returns the first usable message", () => {
        expect(extractErrorMessage(["", { msg: "Email taken" }])).toBe(
            "Email taken"
        );
        expect(extractErrorMessage([{}, {}])).toBeNull();
    });

    it("recurses into nested {error|message|msg} envelopes", () => {
        expect(extractErrorMessage({ error: "Project missing" })).toBe(
            "Project missing"
        );
        expect(extractErrorMessage({ message: "Unauthorized" })).toBe(
            "Unauthorized"
        );
        expect(extractErrorMessage({ msg: "Name is required" })).toBe(
            "Name is required"
        );
    });

    it("cascades when the first candidate field resolves to nothing", () => {
        expect(
            extractErrorMessage({
                error: { unrelated: true },
                message: "Real message"
            })
        ).toBe("Real message");
    });

    it("extracts FastAPI-style validation arrays", () => {
        expect(
            extractErrorMessage({ error: [{ msg: "Email has been taken" }] })
        ).toBe("Email has been taken");
    });
});
