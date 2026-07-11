import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Checkbox } from "./checkbox";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

describe("Checkbox", () => {
    it("reports checked state via onCheckedChange", () => {
        const onCheckedChange = jest.fn();
        render(
            <Checkbox aria-label="Accept" onCheckedChange={onCheckedChange} />
        );
        fireEvent.click(screen.getByRole("checkbox", { name: "Accept" }));
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Checkbox aria-label="Accept" />);
        expect(
            declaresTouchTarget(
                screen.getByRole("checkbox", { name: "Accept" })
            )
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Checkbox aria-label="Accept terms" />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
