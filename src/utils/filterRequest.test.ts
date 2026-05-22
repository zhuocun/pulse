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
});
