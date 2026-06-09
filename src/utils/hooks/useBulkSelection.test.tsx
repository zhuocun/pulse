import { act, render, screen } from "@testing-library/react";

import useBulkSelection, { BulkSelectionProvider } from "./useBulkSelection";

const Probe = () => {
    const { enabled, count, isSelected, toggle, clear } = useBulkSelection();
    return (
        <div>
            <span data-testid="enabled">{String(enabled)}</span>
            <span data-testid="count">{count}</span>
            <span data-testid="t1">{String(isSelected("t1"))}</span>
            <button onClick={() => toggle("t1")} type="button">
                toggle-t1
            </button>
            <button onClick={() => toggle("t2")} type="button">
                toggle-t2
            </button>
            <button onClick={() => clear()} type="button">
                clear
            </button>
        </div>
    );
};

describe("useBulkSelection", () => {
    it("defaults to a disabled no-op outside a provider", () => {
        render(<Probe />);
        expect(screen.getByTestId("enabled")).toHaveTextContent("false");
        expect(screen.getByTestId("count")).toHaveTextContent("0");
        // toggle is a no-op without a provider — count stays 0.
        act(() => {
            screen.getByText("toggle-t1").click();
        });
        expect(screen.getByTestId("count")).toHaveTextContent("0");
    });

    it("toggles, deduplicates, and clears membership under a provider", () => {
        render(
            <BulkSelectionProvider>
                <Probe />
            </BulkSelectionProvider>
        );
        expect(screen.getByTestId("enabled")).toHaveTextContent("true");

        act(() => screen.getByText("toggle-t1").click());
        act(() => screen.getByText("toggle-t2").click());
        expect(screen.getByTestId("count")).toHaveTextContent("2");
        expect(screen.getByTestId("t1")).toHaveTextContent("true");

        // Toggling an already-selected id removes it.
        act(() => screen.getByText("toggle-t1").click());
        expect(screen.getByTestId("count")).toHaveTextContent("1");
        expect(screen.getByTestId("t1")).toHaveTextContent("false");

        act(() => screen.getByText("clear").click());
        expect(screen.getByTestId("count")).toHaveTextContent("0");
    });
});
