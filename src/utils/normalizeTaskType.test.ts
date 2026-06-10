import normalizeTaskType from "./normalizeTaskType";

describe("normalizeTaskType", () => {
    it("passes the two canonical values through", () => {
        expect(normalizeTaskType("Task")).toBe("Task");
        expect(normalizeTaskType("Bug")).toBe("Bug");
    });

    it("normalizes out-of-vocabulary values to 'Task'", () => {
        expect(normalizeTaskType("feature")).toBe("Task");
        expect(normalizeTaskType("bug")).toBe("Task");
        expect(normalizeTaskType("")).toBe("Task");
    });

    it("normalizes undefined to 'Task'", () => {
        expect(normalizeTaskType(undefined)).toBe("Task");
    });
});
