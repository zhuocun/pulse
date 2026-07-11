import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import useUnsavedChangesGuard from "./useUnsavedChangesGuard";

/**
 * Minimal harness: a button that calls `requestClose`, a live dirty toggle,
 * and the guard's `confirmNode`. `onConfirmDiscard` is a spy so each test can
 * assert whether the discard actually ran.
 */
const Harness: React.FC<{
    onConfirmDiscard: () => void;
    initialDirty?: boolean;
}> = ({ onConfirmDiscard, initialDirty = false }) => {
    const [dirty, setDirty] = useState(initialDirty);
    const { requestClose, confirmNode, isPrompting } = useUnsavedChangesGuard({
        isDirty: () => dirty,
        onConfirmDiscard
    });
    return (
        <>
            <button onClick={() => setDirty(true)} type="button">
                make dirty
            </button>
            <button onClick={requestClose} type="button">
                close
            </button>
            <span data-testid="prompting">{String(isPrompting)}</span>
            {confirmNode}
        </>
    );
};

describe("useUnsavedChangesGuard", () => {
    it("closes immediately without prompting when the form is clean", () => {
        const onConfirmDiscard = jest.fn();
        render(<Harness onConfirmDiscard={onConfirmDiscard} />);

        fireEvent.click(screen.getByRole("button", { name: "close" }));

        expect(onConfirmDiscard).toHaveBeenCalledTimes(1);
        // No discard prompt rendered.
        expect(
            screen.queryByRole("button", { name: "Discard" })
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("prompting")).toHaveTextContent("false");
    });

    it("prompts before discarding when the form is dirty", () => {
        const onConfirmDiscard = jest.fn();
        render(<Harness initialDirty onConfirmDiscard={onConfirmDiscard} />);

        fireEvent.click(screen.getByRole("button", { name: "close" }));

        // The prompt is shown and the discard has NOT run yet.
        expect(onConfirmDiscard).not.toHaveBeenCalled();
        expect(screen.getByTestId("prompting")).toHaveTextContent("true");
        expect(
            screen.getByRole("button", { name: "Discard" })
        ).toBeInTheDocument();
    });

    it("exposes Radix dialog semantics: name from title, described-by body", () => {
        const onConfirmDiscard = jest.fn();
        render(<Harness initialDirty onConfirmDiscard={onConfirmDiscard} />);

        fireEvent.click(screen.getByRole("button", { name: "close" }));

        // The confirm is a Radix dialog whose accessible name is the
        // DialogTitle and whose description is wired via aria-describedby.
        const dialog = screen.getByRole("dialog", { name: "Discard changes?" });
        const describedBy = dialog.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        const description = document.getElementById(describedBy as string);
        expect(description).toHaveTextContent(
            "Your unsaved changes will be lost."
        );
    });

    it("keeps editing (no discard) when the prompt is cancelled", () => {
        const onConfirmDiscard = jest.fn();
        render(<Harness initialDirty onConfirmDiscard={onConfirmDiscard} />);

        fireEvent.click(screen.getByRole("button", { name: "close" }));
        // "Keep editing" closes the dialog (onOpenChange(false)) without
        // running the discard.
        fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

        expect(onConfirmDiscard).not.toHaveBeenCalled();
        expect(screen.getByTestId("prompting")).toHaveTextContent("false");
        expect(
            screen.queryByRole("button", { name: "Discard" })
        ).not.toBeInTheDocument();
    });

    it("runs the discard after the prompt is confirmed", () => {
        const onConfirmDiscard = jest.fn();
        render(<Harness initialDirty onConfirmDiscard={onConfirmDiscard} />);

        fireEvent.click(screen.getByRole("button", { name: "close" }));
        fireEvent.click(screen.getByRole("button", { name: "Discard" }));

        expect(onConfirmDiscard).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("prompting")).toHaveTextContent("false");
    });

    it("reads dirty state live, not at mount", () => {
        const onConfirmDiscard = jest.fn();
        render(<Harness onConfirmDiscard={onConfirmDiscard} />);

        // Becomes dirty AFTER mount; the guard must observe the latest value.
        fireEvent.click(screen.getByRole("button", { name: "make dirty" }));
        fireEvent.click(screen.getByRole("button", { name: "close" }));

        expect(onConfirmDiscard).not.toHaveBeenCalled();
        expect(
            screen.getByRole("button", { name: "Discard" })
        ).toBeInTheDocument();
    });
});
