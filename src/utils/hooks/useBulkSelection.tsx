import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState
} from "react";

/**
 * Board multi-select state (PRD-GAP-008). A single source of truth for
 * "which task cards are selected", shared between the task cards (which
 * toggle membership) and the bulk-edit toolbar (which reads the set and
 * fans the change out over `PUT /tasks/bulk`).
 *
 * Why context instead of prop-threading: `Column` is `React.memo`'d and the
 * board hands it stable prop refs, so threading a selection set through the
 * board → column → card chain would either defeat the memo (new ref every
 * toggle) or require re-plumbing every column. Context lets only the actual
 * consumers (the cards + the toolbar) re-render on a selection change.
 *
 * The default value is a DISABLED no-op so a card rendered outside a
 * provider (e.g. the column unit tests, the share/read-only viewer) simply
 * renders no selection affordance — `enabled` is the render gate.
 */
interface BulkSelectionValue {
    /** True only under a provider; the card's selection UI gates on this. */
    enabled: boolean;
    selectedIds: ReadonlySet<string>;
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    clear: () => void;
    count: number;
}

const DISABLED: BulkSelectionValue = {
    enabled: false,
    selectedIds: new Set<string>(),
    isSelected: () => false,
    toggle: () => undefined,
    clear: () => undefined,
    count: 0
};

const BulkSelectionContext = createContext<BulkSelectionValue>(DISABLED);

export const BulkSelectionProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(
        () => new Set<string>()
    );

    const toggle = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    // Identity-stable when already empty so an idle "clear" doesn't force a
    // re-render of every subscribed card.
    const clear = useCallback(() => {
        setSelectedIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
    }, []);

    const isSelected = useCallback(
        (id: string) => selectedIds.has(id),
        [selectedIds]
    );

    const value = useMemo<BulkSelectionValue>(
        () => ({
            enabled: true,
            selectedIds,
            isSelected,
            toggle,
            clear,
            count: selectedIds.size
        }),
        [selectedIds, isSelected, toggle, clear]
    );

    return (
        <BulkSelectionContext.Provider value={value}>
            {children}
        </BulkSelectionContext.Provider>
    );
};

const useBulkSelection = (): BulkSelectionValue =>
    useContext(BulkSelectionContext);

export default useBulkSelection;
