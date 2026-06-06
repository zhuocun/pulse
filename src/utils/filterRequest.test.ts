import filterRequest from "./filterRequest";

describe("filterRequest", () => {
    it("removes void request values while keeping meaningful falsy and structured values", () => {
        const nested = { active: true };
        const list = ["member-1"];
        const params = {
            missing: undefined,
            empty: "",
            nullable: null,
            notANumber: Number.NaN,
            zero: 0,
            enabled: false,
            search: "roadmap",
            list,
            nested
        };

        const result = filterRequest(params);

        expect(result).toEqual({
            zero: 0,
            enabled: false,
            search: "roadmap",
            list,
            nested
        });
    });

    it("returns a new object without mutating the input", () => {
        const params = {
            projectName: "Pulse demo",
            assigneeId: ""
        };

        const result = filterRequest(params);

        expect(result).not.toBe(params);
        expect(params).toEqual({
            projectName: "Pulse demo",
            assigneeId: ""
        });
        expect(result).toEqual({ projectName: "Pulse demo" });
    });

    it("keeps an explicit null/empty-string for a preserved key while still dropping undefined", () => {
        // The opt-in escape hatch: a key in `preserveNullKeys` survives as
        // long as its value isn't `undefined`, so a cleared `null`/`""`
        // reaches the wire to CLEAR the field instead of being stripped.
        expect(filterRequest({ milestoneId: null }, ["milestoneId"])).toEqual({
            milestoneId: null
        });
        expect(filterRequest({ milestoneId: "" }, ["milestoneId"])).toEqual({
            milestoneId: ""
        });
        // `undefined` is still dropped even for a preserved key — there is no
        // value to send, so the key stays absent.
        expect(
            filterRequest({ milestoneId: undefined }, ["milestoneId"])
        ).toEqual({});
        // A populated preserved key passes through unchanged.
        expect(filterRequest({ milestoneId: "m1" }, ["milestoneId"])).toEqual({
            milestoneId: "m1"
        });
    });

    it("only spares the listed keys — other void keys are still stripped", () => {
        // `milestoneId` is preserved, but a sibling `null`/`""`/`NaN` key not
        // in the list keeps the default void-stripping; meaningful falsy
        // values (`0`, `false`) survive regardless.
        const result = filterRequest(
            {
                milestoneId: null,
                parentTaskId: null,
                epic: "",
                points: Number.NaN,
                zero: 0,
                enabled: false
            },
            ["milestoneId"]
        );

        expect(result).toEqual({
            milestoneId: null,
            zero: 0,
            enabled: false
        });
    });

    it("matches the default behavior when preserveNullKeys is empty", () => {
        // An empty preserve list must behave byte-identically to the
        // single-arg call so the default path is provably unchanged.
        const params = {
            milestoneId: null,
            search: "roadmap",
            empty: ""
        };

        expect(filterRequest(params, [])).toEqual(filterRequest(params));
        expect(filterRequest(params, [])).toEqual({ search: "roadmap" });
    });
});
