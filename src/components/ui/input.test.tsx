import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Input } from "./input";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

describe("Input", () => {
    it("forwards value and change events", () => {
        const onChange = jest.fn();
        render(<Input aria-label="Email" onChange={onChange} />);
        const input = screen.getByRole("textbox", { name: "Email" });
        fireEvent.change(input, { target: { value: "a@b.co" } });
        expect(onChange).toHaveBeenCalled();
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Input aria-label="Email" />);
        expect(
            declaresTouchTarget(screen.getByRole("textbox", { name: "Email" }))
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <>
                <label htmlFor="email">Email</label>
                <Input id="email" placeholder="you@example.com" />
            </>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
