import { __testing_reformulate as reformulate } from "./index";

describe("aiSearchInput reformulator", () => {
    it("returns nothing for an empty query", () => {
        expect(reformulate("")).toEqual([]);
        expect(reformulate("   ")).toEqual([]);
    });

    it("offers the broader-scope, tasks-about, and open-prefixed candidates", () => {
        const out = reformulate("flaky login flow");
        // Broader scope (first two words), `tasks about …`, and `open …`
        // candidates should all appear; the original is filtered as a
        // self-match by the dedupe seed.
        expect(out).toEqual(
            expect.arrayContaining([
                "flaky login",
                "tasks about flaky login flow",
                "open flaky login flow"
            ])
        );
    });

    it("never emits a duplicate-prefix candidate (`open open …`)", () => {
        // Quick win 18: previously this produced "open open the door"
        // because `open ${trimmed}` was unconditional. The guard skips
        // the template when the head word already matches the prefix.
        const out = reformulate("open the door");
        expect(
            out.every((candidate) => !/^open\s+open\b/i.test(candidate))
        ).toBe(true);
    });

    it("never emits a duplicate `tasks about tasks about …` candidate", () => {
        const out = reformulate("tasks blocking release");
        expect(
            out.every((candidate) => !/^tasks about tasks\b/i.test(candidate))
        ).toBe(true);
    });

    it("is case-insensitive when deciding to suppress a duplicate prefix", () => {
        const out = reformulate("OPEN issues today");
        expect(
            out.every((candidate) => !/^open\s+OPEN\b/i.test(candidate))
        ).toBe(true);
    });

    it("never emits more than three suggestions", () => {
        const out = reformulate("one two three four five");
        expect(out.length).toBeLessThanOrEqual(3);
    });
});
