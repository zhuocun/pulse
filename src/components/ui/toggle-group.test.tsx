import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { declaresTouchTarget } from "./testHelpers";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

expect.extend(toHaveNoViolations);

const Example = ({
    onValueChange
}: {
    onValueChange?: (v: string) => void;
}) => (
    <ToggleGroup
        type="single"
        defaultValue="list"
        aria-label="View"
        onValueChange={onValueChange}
    >
        <ToggleGroupItem value="list">List</ToggleGroupItem>
        <ToggleGroupItem value="board">Board</ToggleGroupItem>
    </ToggleGroup>
);

describe("ToggleGroup", () => {
    it("changes selection and fires onValueChange", () => {
        const onValueChange = jest.fn();
        render(<Example onValueChange={onValueChange} />);
        fireEvent.click(screen.getByRole("radio", { name: "Board" }));
        expect(onValueChange).toHaveBeenCalledWith("board");
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Example />);
        expect(
            declaresTouchTarget(screen.getByRole("radio", { name: "List" }))
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Example />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
