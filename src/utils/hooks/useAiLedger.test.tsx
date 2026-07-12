import { act, fireEvent, render, screen } from "@testing-library/react";
import { message } from "@/components/ui/toast";
import { Provider } from "react-redux";

import { store } from "../../store";
import {
    AI_LEDGER_MAX_ENTRIES,
    aiLedgerActions
} from "../../store/reducers/aiLedgerSlice";

import useAiLedger, {
    __resetAiLedgerUndoCallbacksForTests
} from "./useAiLedger";

const Probe: React.FC<{
    capture?: (api: ReturnType<typeof useAiLedger>) => void;
}> = ({ capture }) => {
    const api = useAiLedger();
    if (capture) capture(api);
    return (
        <ul data-testid="entries">
            {api.entries.map((entry) => (
                <li
                    key={entry.id}
                    data-revertable={api.isRevertable(entry.id) ? "yes" : "no"}
                >
                    {entry.description}
                </li>
            ))}
        </ul>
    );
};

const renderProbe = () => {
    let apiRef: ReturnType<typeof useAiLedger> | null = null;
    const utils = render(
        <Provider store={store}>
            <Probe capture={(api) => (apiRef = api)} />
        </Provider>
    );
    return {
        ...utils,
        getApi: () => {
            if (!apiRef) throw new Error("Probe never rendered");
            return apiRef;
        }
    };
};

describe("useAiLedger", () => {
    beforeEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    afterEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    it("record() appends an entry with an auto id + timestamp + live undo", () => {
        const probe = renderProbe();
        const before = Date.now();
        act(() => {
            probe.getApi().record({
                description: "Applied story points",
                surface: "task-assist",
                undo: jest.fn()
            });
        });
        const entries = probe.getApi().entries;
        expect(entries).toHaveLength(1);
        expect(entries[0].description).toBe("Applied story points");
        expect(entries[0].id).toMatch(/^ledger-/);
        expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(probe.getApi().isRevertable(entries[0].id)).toBe(true);
    });

    it("record() without an undo marks the entry non-revertable", () => {
        const probe = renderProbe();
        act(() => {
            probe.getApi().record({
                description: "Logged proposal",
                surface: "mutation-proposal"
            });
        });
        const entry = probe.getApi().entries[0];
        expect(entry.undo).toBeUndefined();
        expect(probe.getApi().isRevertable(entry.id)).toBe(false);
    });

    it("revert() runs the undo, removes the entry, and clears the callback slot", async () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            probe.getApi().record({
                description: "Apply",
                surface: "task-assist",
                undo
            });
        });
        const id = probe.getApi().entries[0].id;
        await act(async () => {
            await probe.getApi().revert(id);
        });
        expect(undo).toHaveBeenCalledTimes(1);
        expect(probe.getApi().entries).toHaveLength(0);
        expect(probe.getApi().isRevertable(id)).toBe(false);
    });

    it("revert() leaves the entry alone and shows a toast when undo throws", async () => {
        const errSpy = jest
            .spyOn(message, "error")
            .mockImplementation(() => ({}) as ReturnType<typeof message.error>);
        const probe = renderProbe();
        const undo = jest.fn().mockRejectedValue(new Error("boom"));
        act(() => {
            probe.getApi().record({
                description: "Apply",
                surface: "task-assist",
                undo
            });
        });
        const id = probe.getApi().entries[0].id;
        await act(async () => {
            await probe.getApi().revert(id);
        });
        expect(undo).toHaveBeenCalledTimes(1);
        expect(probe.getApi().entries).toHaveLength(1);
        expect(probe.getApi().isRevertable(id)).toBe(true);
        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining("boom"),
            expect.any(Number)
        );
        errSpy.mockRestore();
    });

    it("revert() is a no-op when the callback Map has no entry for the id (post-reload state)", async () => {
        const probe = renderProbe();
        // Simulate a reload: Redux entry persists but the callback Map is empty.
        act(() => {
            store.dispatch(
                aiLedgerActions.recordAiLedgerEntry({
                    id: "ledger-test-1",
                    timestamp: Date.now(),
                    description: "Pre-reload entry",
                    surface: "task-assist",
                    undoable: true
                })
            );
        });
        expect(probe.getApi().isRevertable("ledger-test-1")).toBe(false);
        await act(async () => {
            await probe.getApi().revert("ledger-test-1");
        });
        // The entry should still be there because no callback could run.
        expect(probe.getApi().entries).toHaveLength(1);
    });

    it("clear() empties Redux entries AND the callback Map", async () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            probe.getApi().record({
                description: "A",
                surface: "task-assist",
                undo
            });
            probe.getApi().record({
                description: "B",
                surface: "task-draft",
                undo
            });
        });
        const firstId = probe.getApi().entries[0].id;
        act(() => {
            probe.getApi().clear();
        });
        expect(probe.getApi().entries).toHaveLength(0);
        expect(probe.getApi().isRevertable(firstId)).toBe(false);
        // A subsequent revert call on the freed id should not crash.
        await act(async () => {
            await probe.getApi().revert(firstId);
        });
        expect(undo).not.toHaveBeenCalled();
    });

    it("caps entries at AI_LEDGER_MAX_ENTRIES and frees the evicted undo callback", () => {
        const probe = renderProbe();
        const oldestUndo = jest.fn();
        act(() => {
            probe.getApi().record({
                description: "Oldest",
                surface: "task-assist",
                undo: oldestUndo
            });
        });
        const oldestId = probe.getApi().entries[0].id;
        // Push enough records to evict the oldest.
        act(() => {
            for (let i = 0; i < AI_LEDGER_MAX_ENTRIES; i++) {
                probe.getApi().record({
                    description: `Filler ${i}`,
                    surface: "task-assist",
                    undo: jest.fn()
                });
            }
        });
        expect(probe.getApi().entries).toHaveLength(AI_LEDGER_MAX_ENTRIES);
        // The oldest must no longer be in the entry list AND its callback
        // must be freed from the Map.
        expect(
            probe.getApi().entries.some((entry) => entry.id === oldestId)
        ).toBe(false);
        expect(probe.getApi().isRevertable(oldestId)).toBe(false);
    });

    /*
     * Regression test for A8 review issue #1. The previous double-
     * conditional sweep in `record()` skipped when the NEW entry had no
     * undo callback (Map size didn't grow). The 51st record without
     * undo therefore evicted the oldest Redux entry but left its closure
     * orphaned in the Map. The unconditional sweep fixes this.
     */
    it("evicts the oldest closure even when the 51st record has no undo callback (issue #1)", () => {
        const probe = renderProbe();
        const oldestUndo = jest.fn();
        act(() => {
            probe.getApi().record({
                description: "Oldest",
                surface: "task-assist",
                undo: oldestUndo
            });
        });
        const oldestId = probe.getApi().entries[0].id;
        // Fill with AI_LEDGER_MAX_ENTRIES - 1 more entries WITH undo
        // callbacks (these are the entries that will survive eviction).
        act(() => {
            for (let i = 0; i < AI_LEDGER_MAX_ENTRIES - 1; i++) {
                probe.getApi().record({
                    description: `Filler ${i}`,
                    surface: "task-assist",
                    undo: jest.fn()
                });
            }
        });
        // We are now at AI_LEDGER_MAX_ENTRIES (50) entries in Redux AND
        // the Map. The oldest is still alive at this point.
        expect(probe.getApi().entries).toHaveLength(AI_LEDGER_MAX_ENTRIES);
        expect(probe.getApi().isRevertable(oldestId)).toBe(true);
        // Now record the 51st entry WITHOUT an undo callback. Before
        // the fix, this would not grow Map size (the new entry has no
        // closure), so the conditional sweep would not fire and
        // `oldestUndo` would remain in the Map even though its Redux
        // entry was evicted.
        act(() => {
            probe.getApi().record({
                description: "No-undo 51st",
                surface: "mutation-proposal"
                // intentional: no `undo` so Map size stays at 50.
            });
        });
        expect(probe.getApi().entries).toHaveLength(AI_LEDGER_MAX_ENTRIES);
        // The Redux entry for the oldest is gone (the reducer evicts it).
        expect(
            probe.getApi().entries.some((entry) => entry.id === oldestId)
        ).toBe(false);
        // AND the callback Map slot is gone — this is the regression the
        // fix closes. Before the unconditional sweep, this assertion
        // failed: the closure stayed pinned in memory forever.
        expect(probe.getApi().isRevertable(oldestId)).toBe(false);
    });

    /*
     * Regression test for A8 review issue #6. `revert(id)` must claim the
     * Map slot atomically so a re-entrant call (two near-simultaneous
     * Revert clicks for the same id) cannot fire the undo callback twice.
     */
    it("revert() is re-entrant: a second concurrent call for the same id no-ops (issue #6)", async () => {
        const probe = renderProbe();
        let resolveUndo: (() => void) | null = null;
        const undo = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveUndo = resolve;
                })
        );
        act(() => {
            probe.getApi().record({
                description: "Slow undo",
                surface: "task-assist",
                undo
            });
        });
        const id = probe.getApi().entries[0].id;
        // Kick off two reverts back-to-back without awaiting in between
        // — the first claims the closure, the second should see an
        // empty Map slot and bail out without calling `undo` again.
        let firstSettled = false;
        let secondSettled = false;
        await act(async () => {
            const firstPromise = probe
                .getApi()
                .revert(id)
                .then(() => {
                    firstSettled = true;
                });
            const secondPromise = probe
                .getApi()
                .revert(id)
                .then(() => {
                    secondSettled = true;
                });
            // The second one resolves immediately (no live closure).
            await secondPromise;
            // Then resolve the first one's underlying undo.
            resolveUndo?.();
            await firstPromise;
        });
        expect(firstSettled).toBe(true);
        expect(secondSettled).toBe(true);
        // Despite two concurrent calls, the undo closure fires exactly
        // once. This was the issue #6 hardening target.
        expect(undo).toHaveBeenCalledTimes(1);
        expect(probe.getApi().entries).toHaveLength(0);
    });

    /*
     * Tests for the `remove(id)` synchronization helper added in this
     * revision. Surfaces call `remove(id)` after performing their own
     * undo (toast Undo, in-card Undo) so the ledger row drops without
     * re-firing the recorded closure.
     */
    it("remove(id) drops the entry from both Redux and the callback Map without firing undo", () => {
        const probe = renderProbe();
        const undo = jest.fn();
        let recordedId = "";
        act(() => {
            recordedId = probe.getApi().record({
                description: "Apply",
                surface: "task-assist",
                undo
            });
        });
        expect(probe.getApi().entries).toHaveLength(1);
        expect(probe.getApi().isRevertable(recordedId)).toBe(true);
        act(() => {
            probe.getApi().remove(recordedId);
        });
        expect(undo).not.toHaveBeenCalled();
        expect(probe.getApi().entries).toHaveLength(0);
        expect(probe.getApi().isRevertable(recordedId)).toBe(false);
    });

    it("remove(id) is a no-op for an unknown id (post-revert state)", () => {
        const probe = renderProbe();
        act(() => {
            probe.getApi().remove("ledger-unknown-id");
        });
        expect(probe.getApi().entries).toHaveLength(0);
    });

    it("record() returns the new entry id so surfaces can sync local undo paths", () => {
        const probe = renderProbe();
        let recordedId = "";
        act(() => {
            recordedId = probe.getApi().record({
                description: "Apply",
                surface: "task-assist",
                undo: jest.fn()
            });
        });
        expect(recordedId).toMatch(/^ledger-/);
        expect(probe.getApi().entries[0].id).toBe(recordedId);
    });

    it("renders the live entry list via the standard React update path", () => {
        const probe = renderProbe();
        act(() => {
            probe
                .getApi()
                .record({ description: "Visible", surface: "task-assist" });
        });
        expect(screen.getByText("Visible")).toBeInTheDocument();
        // The non-revertable entry should be reflected in the data-revertable attr.
        const li = screen.getByText("Visible");
        expect(li.getAttribute("data-revertable")).toBe("no");
    });

    it("re-rendering the probe with a fresh undo callback updates the entries snapshot", () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            probe.getApi().record({
                description: "X",
                surface: "task-assist",
                undo
            });
        });
        // Force one more event to ensure subscription is live.
        const li = screen.getByText("X");
        fireEvent.click(li);
        expect(probe.getApi().entries[0].undo).toBe(undo);
    });
});
