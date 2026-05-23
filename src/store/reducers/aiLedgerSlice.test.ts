import {
    AI_LEDGER_MAX_ENTRIES,
    aiLedgerActions,
    aiLedgerSlice,
    type AiLedgerEntryState
} from "./aiLedgerSlice";

const initialState = aiLedgerSlice.getInitialState();

const makeEntry = (id: string, undoable = true): AiLedgerEntryState => ({
    id,
    timestamp: 1_700_000_000_000 + Number(id.replace(/[^0-9]/g, "") || 0),
    description: `Entry ${id}`,
    surface: "task-assist",
    undoable
});

describe("aiLedgerSlice", () => {
    it("seeds with an empty entries list", () => {
        expect(aiLedgerSlice.reducer(undefined, { type: "@@INIT" })).toEqual({
            entries: []
        });
    });

    it("recordAiLedgerEntry appends in order", () => {
        const next = aiLedgerSlice.reducer(
            initialState,
            aiLedgerActions.recordAiLedgerEntry(makeEntry("a1"))
        );
        const after = aiLedgerSlice.reducer(
            next,
            aiLedgerActions.recordAiLedgerEntry(makeEntry("a2", false))
        );
        expect(after.entries.map((entry) => entry.id)).toEqual(["a1", "a2"]);
        expect(after.entries[1].undoable).toBe(false);
    });

    it("removeAiLedgerEntry drops the matching id and leaves the rest", () => {
        let state = initialState;
        ["a1", "a2", "a3"].forEach((id) => {
            state = aiLedgerSlice.reducer(
                state,
                aiLedgerActions.recordAiLedgerEntry(makeEntry(id))
            );
        });
        const next = aiLedgerSlice.reducer(
            state,
            aiLedgerActions.removeAiLedgerEntry("a2")
        );
        expect(next.entries.map((entry) => entry.id)).toEqual(["a1", "a3"]);
    });

    it("removeAiLedgerEntry no-ops for an unknown id", () => {
        let state = initialState;
        state = aiLedgerSlice.reducer(
            state,
            aiLedgerActions.recordAiLedgerEntry(makeEntry("a1"))
        );
        const next = aiLedgerSlice.reducer(
            state,
            aiLedgerActions.removeAiLedgerEntry("nope")
        );
        expect(next.entries.map((entry) => entry.id)).toEqual(["a1"]);
    });

    it("clearAiLedger empties the entry list", () => {
        let state = initialState;
        ["a1", "a2"].forEach((id) => {
            state = aiLedgerSlice.reducer(
                state,
                aiLedgerActions.recordAiLedgerEntry(makeEntry(id))
            );
        });
        const cleared = aiLedgerSlice.reducer(
            state,
            aiLedgerActions.clearAiLedger()
        );
        expect(cleared.entries).toEqual([]);
    });

    it("caps the list at AI_LEDGER_MAX_ENTRIES, evicting from the front", () => {
        let state = initialState;
        for (let i = 0; i < AI_LEDGER_MAX_ENTRIES + 5; i++) {
            state = aiLedgerSlice.reducer(
                state,
                aiLedgerActions.recordAiLedgerEntry(makeEntry(`a${i}`))
            );
        }
        expect(state.entries.length).toBe(AI_LEDGER_MAX_ENTRIES);
        // The first 5 entries (oldest) should have been evicted.
        expect(state.entries[0].id).toBe("a5");
        expect(state.entries[state.entries.length - 1].id).toBe(
            `a${AI_LEDGER_MAX_ENTRIES + 4}`
        );
    });
});
