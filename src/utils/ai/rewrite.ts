/**
 * "Rewrite with AI" engine (PRD v3 §7.5, v2.1 AC-V12).
 *
 * Two responsibilities, mirroring the dual-engine split the rest of the AI
 * surface uses (`engine.ts` deterministic local + `useAgent` remote SSE):
 *
 *   - {@link buildRewritePrompt} composes the instruction sent to the
 *     remote `chat-agent` so it returns *only* the rewritten note text.
 *   - {@link rewriteNoteLocally} is the deterministic offline fallback used
 *     when `environment.aiUseLocalEngine` is true (no remote round-trip).
 *     It cannot translate or follow arbitrary free prompts — those modes
 *     return the note unchanged offline — but the structural rewrites
 *     (user story, acceptance criteria, summarize, polish) are real.
 *
 * {@link diffLines} powers the >3-line diff view in the side panel.
 */

export type RewriteMode =
    | "userStory"
    | "acceptanceCriteria"
    | "translate"
    | "summarize"
    | "polish"
    | "free";

/** Ordered list of rewrite options as they appear in the side panel. */
export const REWRITE_MODES: readonly RewriteMode[] = [
    "userStory",
    "acceptanceCriteria",
    "translate",
    "summarize",
    "polish",
    "free"
];

export interface RewriteRequest {
    mode: RewriteMode;
    note: string;
    /** Human-readable target language for `translate` (e.g. "Chinese"). */
    localeName?: string;
    /** User instruction for the `free` mode. */
    freePrompt?: string;
}

const deCapitalize = (value: string): string =>
    value.length === 0 ? value : value.charAt(0).toLowerCase() + value.slice(1);

const capitalize = (value: string): string =>
    value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);

const firstNonEmptyLine = (note: string): string => {
    for (const line of note.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) return trimmed;
    }
    return "";
};

/**
 * Build the user-turn prompt for the remote `chat-agent`. The closing
 * "Return only…" guard keeps the agent from wrapping the rewrite in chat
 * pleasantries so the side panel can drop the answer straight into the
 * note field on Accept.
 */
export const buildRewritePrompt = (request: RewriteRequest): string => {
    const note = request.note.trim();
    let instruction: string;
    switch (request.mode) {
        case "userStory":
            instruction =
                'Rewrite the following task note as a concise agile user story in the form "As a <role>, I want <capability> so that <benefit>", followed by a short "Acceptance criteria" bulleted list.';
            break;
        case "acceptanceCriteria":
            instruction =
                'Rewrite the following task note so it ends with a clear, testable "Acceptance criteria" section as a bulleted list. Preserve the existing content above it.';
            break;
        case "translate":
            instruction = `Translate the following task note into ${
                request.localeName ?? "the user's language"
            }. Preserve any Markdown structure and headings.`;
            break;
        case "summarize":
            instruction =
                "Summarize the following task note in at most two short sentences.";
            break;
        case "polish":
            instruction =
                "Polish the tone, grammar, and clarity of the following task note without changing its meaning or removing information.";
            break;
        case "free":
            instruction =
                (request.freePrompt ?? "").trim() ||
                "Improve the following task note.";
            break;
    }
    return `${instruction}\n\nReturn only the rewritten note text with no preamble, explanation, or surrounding quotation marks.\n\nNote:\n"""\n${note}\n"""`;
};

const localUserStory = (note: string): string => {
    const summary = firstNonEmptyLine(note) || "this capability";
    const trimmed = summary.replace(/[.!?]+$/, "");
    return [
        `As a user, I want ${deCapitalize(trimmed)} so that the desired outcome is achieved.`,
        "",
        "## Acceptance criteria",
        `- ${capitalize(trimmed)} is implemented end to end`,
        "- The behaviour is covered by tests",
        "- User-visible copy is reviewed"
    ].join("\n");
};

const localAcceptanceCriteria = (note: string): string => {
    const base = note.trim();
    const hasAcceptance = /acceptance\s+criteria/i.test(base);
    const block = [
        "## Acceptance criteria",
        "- The described behaviour works end to end",
        "- Edge cases and error states are handled",
        "- Tests cover the new behaviour"
    ].join("\n");
    if (hasAcceptance) return base;
    return base.length > 0 ? `${base}\n\n${block}` : block;
};

const localSummarize = (note: string): string => {
    const flattened = note.replace(/\s+/g, " ").trim();
    if (flattened.length === 0) return "";
    const sentences = flattened
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (sentences.length === 0) return flattened;
    return sentences.slice(0, 2).join(" ");
};

const localPolish = (note: string): string => {
    const cleaned = note
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/u, "").replace(/[ \t]{2,}/g, " "))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    // Capitalize the first letter of each sentence without disturbing
    // Markdown markers (headings / bullets keep their leading glyphs).
    return cleaned.replace(
        /(^|[.!?]\s+|\n[-*]\s+|\n#{1,6}\s+)([a-z])/g,
        (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`
    );
};

/**
 * Deterministic offline rewrite. `translate` and `free` cannot be honoured
 * without a model, so they return the trimmed note unchanged — the remote
 * engine performs the real work for those modes.
 */
export const rewriteNoteLocally = (request: RewriteRequest): string => {
    const note = request.note ?? "";
    switch (request.mode) {
        case "userStory":
            return localUserStory(note);
        case "acceptanceCriteria":
            return localAcceptanceCriteria(note);
        case "summarize":
            return localSummarize(note);
        case "polish":
            return localPolish(note);
        case "translate":
        case "free":
            return note.trim();
    }
};

export interface DiffLine {
    type: "context" | "added" | "removed";
    text: string;
}

/**
 * Line-level diff between two strings via a longest-common-subsequence
 * walk. Used by the side panel to render a before/after view for notes
 * longer than three lines. Deterministic and dependency-free.
 */
export const diffLines = (before: string, after: string): DiffLine[] => {
    const a = before.split("\n");
    const b = after.split("\n");
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
        new Array<number>(n + 1).fill(0)
    );
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            dp[i][j] =
                a[i] === b[j]
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) {
            out.push({ type: "context", text: a[i] });
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: "removed", text: a[i] });
            i += 1;
        } else {
            out.push({ type: "added", text: b[j] });
            j += 1;
        }
    }
    while (i < m) {
        out.push({ type: "removed", text: a[i] });
        i += 1;
    }
    while (j < n) {
        out.push({ type: "added", text: b[j] });
        j += 1;
    }
    return out;
};

/** Notes longer than this many lines render as a diff (OQ9 lean). */
export const REWRITE_DIFF_LINE_THRESHOLD = 3;

export const shouldShowDiff = (note: string): boolean =>
    note.split("\n").length > REWRITE_DIFF_LINE_THRESHOLD;
