import { extractSuggestionRunId } from "./extractSuggestionRunId";

describe("extractSuggestionRunId", () => {
    it("returns the first populated run id field", () => {
        expect(
            extractSuggestionRunId({
                id: "fallback",
                run_id: "run-123"
            })
        ).toBe("run-123");
    });

    it("falls back across the supported keys", () => {
        expect(
            extractSuggestionRunId({
                suggestion_id: "suggestion-123"
            })
        ).toBe("suggestion-123");
    });

    it("returns null for missing or invalid payloads", () => {
        expect(extractSuggestionRunId(null)).toBeNull();
        expect(extractSuggestionRunId("bad-payload")).toBeNull();
        expect(extractSuggestionRunId({ run_id: "" })).toBeNull();
    });
});
