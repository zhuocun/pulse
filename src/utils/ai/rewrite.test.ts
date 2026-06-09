import {
    buildRewritePrompt,
    diffLines,
    REWRITE_DIFF_LINE_THRESHOLD,
    REWRITE_MODES,
    rewriteNoteLocally,
    shouldShowDiff,
    type RewriteMode
} from "./rewrite";

describe("rewrite engine — buildRewritePrompt", () => {
    const note = "Build the export button.";

    it("embeds the note and the return-only guard for every mode", () => {
        REWRITE_MODES.forEach((mode: RewriteMode) => {
            const prompt = buildRewritePrompt({ mode, note });
            expect(prompt).toContain(note);
            expect(prompt).toContain("Return only the rewritten note text");
        });
    });

    it("asks for a user story with acceptance criteria", () => {
        const prompt = buildRewritePrompt({ mode: "userStory", note });
        expect(prompt).toMatch(/As a <role>, I want <capability>/);
        expect(prompt).toMatch(/Acceptance criteria/i);
    });

    it("interpolates the target language for translate", () => {
        const prompt = buildRewritePrompt({
            mode: "translate",
            note,
            localeName: "Chinese (Simplified)"
        });
        expect(prompt).toContain(
            "Translate the following task note into Chinese (Simplified)"
        );
    });

    it("falls back to a generic target language when none is given", () => {
        const prompt = buildRewritePrompt({ mode: "translate", note });
        expect(prompt).toContain("the user's language");
    });

    it("uses the free prompt verbatim, with a fallback when blank", () => {
        expect(
            buildRewritePrompt({
                mode: "free",
                note,
                freePrompt: "Make it punchy"
            })
        ).toContain("Make it punchy");
        expect(
            buildRewritePrompt({ mode: "free", note, freePrompt: "   " })
        ).toContain("Improve the following task note.");
    });
});

describe("rewrite engine — rewriteNoteLocally", () => {
    it("turns a note into a user story with acceptance criteria", () => {
        const out = rewriteNoteLocally({
            mode: "userStory",
            note: "Add CSV export to the reports page."
        });
        expect(out).toMatch(/^As a user, I want add CSV export/);
        expect(out).toContain("## Acceptance criteria");
    });

    it("appends an acceptance-criteria block when none is present", () => {
        const out = rewriteNoteLocally({
            mode: "acceptanceCriteria",
            note: "Users can reset their password."
        });
        expect(out).toContain("Users can reset their password.");
        expect(out).toContain("## Acceptance criteria");
    });

    it("leaves an existing acceptance-criteria section untouched", () => {
        const note = "Do the thing.\n\nAcceptance Criteria\n- it works";
        expect(rewriteNoteLocally({ mode: "acceptanceCriteria", note })).toBe(
            note
        );
    });

    it("summarizes to at most two sentences", () => {
        const note = "One. Two. Three. Four.";
        const out = rewriteNoteLocally({ mode: "summarize", note });
        expect(out).toBe("One. Two.");
    });

    it("polishes by trimming runs of whitespace and capitalising sentences", () => {
        const note = "fix   the bug.   it is bad.   ";
        const out = rewriteNoteLocally({ mode: "polish", note });
        expect(out).toBe("Fix the bug. It is bad.");
    });

    it("returns the trimmed note unchanged for modes it cannot do offline", () => {
        const note = "  hello world  ";
        expect(rewriteNoteLocally({ mode: "translate", note })).toBe(
            "hello world"
        );
        expect(
            rewriteNoteLocally({ mode: "free", note, freePrompt: "x" })
        ).toBe("hello world");
    });
});

describe("rewrite engine — diffLines", () => {
    it("marks unchanged lines as context", () => {
        const diff = diffLines("a\nb", "a\nb");
        expect(diff).toEqual([
            { type: "context", text: "a" },
            { type: "context", text: "b" }
        ]);
    });

    it("captures a replaced middle line as removed + added", () => {
        const diff = diffLines("a\nb\nc", "a\nx\nc");
        expect(diff[0]).toEqual({ type: "context", text: "a" });
        expect(diff[diff.length - 1]).toEqual({ type: "context", text: "c" });
        expect(diff).toContainEqual({ type: "removed", text: "b" });
        expect(diff).toContainEqual({ type: "added", text: "x" });
    });

    it("reports pure additions and deletions at the tail", () => {
        expect(diffLines("a", "a\nb")).toContainEqual({
            type: "added",
            text: "b"
        });
        expect(diffLines("a\nb", "a")).toContainEqual({
            type: "removed",
            text: "b"
        });
    });
});

describe("rewrite engine — shouldShowDiff", () => {
    it("shows a diff only past the line threshold", () => {
        const shortNote = Array.from(
            { length: REWRITE_DIFF_LINE_THRESHOLD },
            (_v, i) => `line ${i}`
        ).join("\n");
        const longNote = `${shortNote}\nline extra`;
        expect(shouldShowDiff(shortNote)).toBe(false);
        expect(shouldShowDiff(longNote)).toBe(true);
    });
});
