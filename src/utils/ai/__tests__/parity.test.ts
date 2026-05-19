/**
 * FE/BE deterministic-engine parity test.
 *
 * The BE has heuristic functions in
 * `backend/app/agents/catalog/task_drafting.py` (`_draft_from_prompt`,
 * `draft_task`, `_type_for`, `_epic_for`) and
 * `backend/app/agents/catalog/search.py` (`semantic_search`) that mirror
 * the FE engine in `src/utils/ai/engine.ts`. This test feeds the same
 * inputs to both engines and compares a curated set of signals
 * (`key_fields`).
 *
 * Golden data is produced by
 * `backend/scripts/generate_parity_golden.py` and committed at
 * `fixtures/parity_golden.json`. The TS engine is exercised live in
 * Jest; the BE engine is *not* re-run here — instead the BE's output
 * is read from the golden file. If the BE heuristic changes, regenerate
 * the golden, run this test, and decide whether the FE also needs to
 * follow.
 *
 * Known drift cases are documented in the fixture file under
 * `expected_drift` and assert that the divergence still exists, not
 * that it has been fixed. Use that as the gate: removing an entry
 * forces a real-parity assertion the next time the test runs.
 */

import {
    detectEpic,
    detectType,
    semanticSearch,
    type AiContextProject,
    type AiSearchProjectsContext
} from "../engine";
import parityFixturesJson from "./fixtures/parity.json";
import parityGoldenJson from "./fixtures/parity_golden.json";

interface DraftFixtureInput {
    prompt: string;
}

interface SearchFixtureInput {
    kind: "tasks" | "projects";
    query: string;
    context: {
        tasks?: Array<{
            _id: string;
            taskName: string;
            note?: string;
            type?: string;
            epic?: string;
        }>;
        projects?: Array<{
            _id: string;
            projectName: string;
            organization?: string;
            managerId?: string;
        }>;
        members?: Array<{ _id: string; username: string }>;
    };
}

type FixtureInput = DraftFixtureInput | SearchFixtureInput;

interface ParityFixture {
    id: string;
    kind: "draft" | "search";
    input: FixtureInput;
    key_fields: string[];
    expected_drift?: Record<string, string>;
}

interface ParityFixturesFile {
    fixtures: ParityFixture[];
}

const fixturesFile = parityFixturesJson as ParityFixturesFile;
const golden = parityGoldenJson as Record<string, Record<string, unknown>>;

// FE detect_type returns "Task" | "Bug"; BE _type_for returns
// "feature" | "bug" | "spike". The Python golden generator canonicalises
// both into the {"bug", "feature_or_task", "spike"} bucket — we mirror
// that mapping here so the comparison happens on the same axis.
const canonicalType = (raw: string): string => {
    switch (raw) {
        case "Bug":
        case "bug":
            return "bug";
        case "Task":
        case "feature":
        case "task":
            return "feature_or_task";
        case "spike":
            return "spike";
        default:
            return raw;
    }
};

// FE default epic = "New Feature"; BE default = "General". Bucket both
// to "DEFAULT" so the comparison is meaningful when neither side hit a
// keyword.
const canonicalEpic = (raw: string): string =>
    raw === "New Feature" || raw === "General" ? "DEFAULT" : raw;

const buildEmptyTaskContext = (): AiContextProject => ({
    project: { _id: "p-fixture", projectName: "Parity" },
    columns: [],
    tasks: [],
    members: []
});

const computeFeDraftSignals = (
    input: DraftFixtureInput
): { type: string; epic: string } => ({
    type: canonicalType(detectType(input.prompt)),
    epic: canonicalEpic(detectEpic(input.prompt))
});

const computeFeSearchSignals = (
    input: SearchFixtureInput
): { ids_set: string[]; ids_order: string[]; has_results: boolean } => {
    if (input.kind === "tasks") {
        const ctx: AiContextProject = {
            ...buildEmptyTaskContext(),
            tasks: (input.context.tasks ?? []) as unknown as ITask[]
        };
        const result = semanticSearch("tasks", input.query, ctx);
        const ids = result.ids ?? [];
        return {
            ids_set: [...ids].sort(),
            ids_order: ids,
            has_results: ids.length > 0
        };
    }
    const projectCtx: AiSearchProjectsContext = {
        projects: (input.context.projects ?? []) as unknown as IProject[],
        members: (input.context.members ?? []) as unknown as IMember[]
    };
    const result = semanticSearch("projects", input.query, projectCtx);
    const ids = result.ids ?? [];
    return {
        ids_set: [...ids].sort(),
        ids_order: ids,
        has_results: ids.length > 0
    };
};

interface FieldComparison {
    field: string;
    fe: unknown;
    be: unknown;
    matches: boolean;
}

const compareField = (
    field: string,
    feValues: Record<string, unknown>,
    beValues: Record<string, unknown>
): FieldComparison => {
    const fe = feValues[field];
    const be = beValues[field];
    const matches = JSON.stringify(fe) === JSON.stringify(be);
    return { field, fe, be, matches };
};

/**
 * Cross-validated drift tracker. The test fails fast if:
 *   - A key_field that is NOT in `expected_drift` diverges (real
 *     regression).
 *   - A field that IS in `expected_drift` happens to match (drift was
 *     silently fixed and the fixture annotation is stale).
 *
 * The second arm keeps the documentation honest: when someone fixes the
 * FE/BE divergence the test forces them to remove the `expected_drift`
 * entry in the same PR.
 */
const assertFixtureParity = (fx: ParityFixture): void => {
    const goldenRow = golden[fx.id];
    if (!goldenRow) {
        throw new Error(
            `Missing golden row for fixture "${fx.id}" — re-run backend/scripts/generate_parity_golden.py.`
        );
    }
    const feValues: Record<string, unknown> =
        fx.kind === "draft"
            ? computeFeDraftSignals(fx.input as DraftFixtureInput)
            : computeFeSearchSignals(fx.input as SearchFixtureInput);
    const expectedDrift = fx.expected_drift ?? {};
    const realDrift: FieldComparison[] = [];
    const staleDrift: FieldComparison[] = [];
    for (const field of fx.key_fields) {
        const cmp = compareField(field, feValues, goldenRow);
        if (cmp.matches && expectedDrift[field]) {
            staleDrift.push(cmp);
        } else if (!cmp.matches && !expectedDrift[field]) {
            realDrift.push(cmp);
        }
    }
    if (realDrift.length > 0 || staleDrift.length > 0) {
        const lines: string[] = [];
        if (realDrift.length > 0) {
            lines.push(`FE/BE drift in fixture "${fx.id}":`);
            for (const cmp of realDrift) {
                lines.push(
                    `  - ${cmp.field}: FE=${JSON.stringify(cmp.fe)} BE=${JSON.stringify(cmp.be)}`
                );
            }
        }
        if (staleDrift.length > 0) {
            lines.push(
                `Stale expected_drift entry in fixture "${fx.id}" — FE and BE now agree:`
            );
            for (const cmp of staleDrift) {
                lines.push(
                    `  - ${cmp.field} now matches (${JSON.stringify(cmp.fe)}). Remove the expected_drift entry.`
                );
            }
        }
        throw new Error(lines.join("\n"));
    }
};

describe("FE/BE parity", () => {
    it("has 20 fixtures committed", () => {
        expect(fixturesFile.fixtures).toHaveLength(20);
    });

    it("every fixture has a matching golden row", () => {
        const fixtureIds = new Set(fixturesFile.fixtures.map((f) => f.id));
        const goldenIds = new Set(Object.keys(golden));
        expect(goldenIds).toEqual(fixtureIds);
    });

    // Generate a separate `it` per fixture so a failure pinpoints which
    // input caused it. Jest table-style tests would also work; per-fixture
    // `it` keeps the failure output familiar.
    for (const fx of fixturesFile.fixtures) {
        it(`parity: ${fx.id} (${fx.kind})`, () => {
            assertFixtureParity(fx);
        });
    }
});
