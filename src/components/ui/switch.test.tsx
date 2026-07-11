import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Switch } from "./switch";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

describe("Switch", () => {
    it("toggles and reports checked state via onCheckedChange", () => {
        const onCheckedChange = jest.fn();
        render(
            <Switch aria-label="Dark mode" onCheckedChange={onCheckedChange} />
        );
        const control = screen.getByRole("switch", { name: "Dark mode" });
        fireEvent.click(control);
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Switch aria-label="Dark mode" />);
        expect(
            declaresTouchTarget(
                screen.getByRole("switch", { name: "Dark mode" })
            )
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Switch aria-label="Dark mode" />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
