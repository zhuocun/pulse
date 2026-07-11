import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { RadioGroup, RadioGroupItem } from "./radio-group";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

const Example = ({
    onValueChange
}: {
    onValueChange?: (v: string) => void;
}) => (
    <RadioGroup
        aria-label="Plan"
        defaultValue="free"
        onValueChange={onValueChange}
    >
        <RadioGroupItem value="free" aria-label="Free" />
        <RadioGroupItem value="pro" aria-label="Pro" />
    </RadioGroup>
);

describe("RadioGroup", () => {
    it("selects an option and fires onValueChange", () => {
        const onValueChange = jest.fn();
        render(<Example onValueChange={onValueChange} />);
        fireEvent.click(screen.getByRole("radio", { name: "Pro" }));
        expect(onValueChange).toHaveBeenCalledWith("pro");
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Example />);
        expect(
            declaresTouchTarget(screen.getByRole("radio", { name: "Free" }))
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Example />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
