import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { declaresTouchTarget } from "./testHelpers";
import { Textarea } from "./textarea";

expect.extend(toHaveNoViolations);

describe("Textarea", () => {
    it("forwards value and change events", () => {
        const onChange = jest.fn();
        render(<Textarea aria-label="Notes" onChange={onChange} />);
        fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
            target: { value: "hi" }
        });
        expect(onChange).toHaveBeenCalled();
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Textarea aria-label="Notes" />);
        expect(
            declaresTouchTarget(screen.getByRole("textbox", { name: "Notes" }))
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <>
                <label htmlFor="notes">Notes</label>
                <Textarea id="notes" />
            </>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
