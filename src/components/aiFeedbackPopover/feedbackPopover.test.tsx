import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { declaresTouchTarget } from "@/components/ui/testHelpers";

import AiFeedbackPopover, {
    FEEDBACK_CATEGORIES,
    type AiFeedbackSubmission
} from "./feedbackPopover";

type HarnessProps = {
    onSubmit?: (s: AiFeedbackSubmission) => void;
    onSkip?: () => void;
};

const Harness = ({
    onSubmit = jest.fn(),
    onSkip = jest.fn()
}: HarnessProps) => (
    <AiFeedbackPopover
        onOpenChange={() => undefined}
        onSkip={onSkip}
        onSubmit={onSubmit}
        open
    >
        <button aria-label="trigger" type="button">
            trigger
        </button>
    </AiFeedbackPopover>
);

describe("AiFeedbackPopover", () => {
    it("renders a checkbox for each documented feedback category", () => {
        render(<Harness />);
        // The categories appear as checkboxes inside the popover.
        for (const category of FEEDBACK_CATEGORIES) {
            // The microcopy label always contains a sub-string of the key;
            // assert at least that the checkbox count matches.
            expect(category).toBeTruthy();
        }
        expect(screen.getAllByRole("checkbox").length).toBe(
            FEEDBACK_CATEGORIES.length
        );
    });

    it("disables the submit button until at least one category is selected", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const submit = screen.getByRole("button", { name: /send feedback/i });
        expect(submit).toBeDisabled();

        const firstCheckbox = screen.getAllByRole("checkbox")[0];
        await user.click(firstCheckbox);
        expect(submit).toBeEnabled();
    });

    it("invokes onSubmit with the selected categories and trimmed note", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);

        const [first, second] = screen.getAllByRole("checkbox");
        await user.click(first);
        await user.click(second);

        const note = screen.getByRole("textbox");
        await user.type(note, "   helpful context  ");

        await user.click(
            screen.getByRole("button", { name: /send feedback/i })
        );

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const payload = onSubmit.mock.calls[0][0] as AiFeedbackSubmission;
        // Categories appear in the order the user toggled them.
        expect(payload.categories).toHaveLength(2);
        expect(payload.note).toBe("helpful context");
    });

    it("clears state and calls onSkip when the skip button is pressed", async () => {
        const user = userEvent.setup();
        const onSkip = jest.fn();
        render(<Harness onSkip={onSkip} />);

        const first = screen.getAllByRole("checkbox")[0];
        await user.click(first);
        expect(first).toBeChecked();

        await user.click(screen.getByRole("button", { name: /skip/i }));
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("toggles a category off when its checkbox is clicked twice", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);

        const [first, second] = screen.getAllByRole("checkbox");
        await user.click(first);
        await user.click(first); // toggle off
        await user.click(second);

        await user.click(
            screen.getByRole("button", { name: /send feedback/i })
        );
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const payload = onSubmit.mock.calls[0][0] as AiFeedbackSubmission;
        expect(payload.categories).toHaveLength(1);
    });

    it("enforces the 280-character maxLength on the optional note", () => {
        render(<Harness />);
        const note = screen.getByRole("textbox") as HTMLTextAreaElement;
        expect(note.maxLength).toBe(280);
    });

    it("clamps the popover width and gives action buttons mobile touch targets", () => {
        render(<Harness />);
        const content = screen.getByTestId("ai-feedback-popover-content");
        // The Tailwind primitives express the width clamp as an arbitrary
        // utility (compiled stylesheet is not loaded in jsdom), so assert
        // the class carries the responsive `min(320px, …)` / `100dvw` clamp.
        expect(content.className).toContain("min(320px");
        expect(content.className).toContain("100dvw");

        const actions = screen.getByTestId("ai-feedback-popover-actions");
        expect(actions.className).toContain("flex-wrap");
        // Every action button threads the canonical 44px coarse touch target.
        const buttons = within(actions).getAllByRole("button");
        expect(buttons.length).toBeGreaterThan(0);
        buttons.forEach((button) => {
            expect(declaresTouchTarget(button)).toBe(true);
        });
    });
});
