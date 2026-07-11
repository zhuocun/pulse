import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "./select";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

/*
 * Radix Select's listbox relies on PointerEvent APIs jsdom doesn't ship, so
 * these tests exercise the closed trigger surface (role, value, a11y,
 * touch-target) — the open-menu interaction is covered by the downstream
 * feature migration's integration tests.
 */
const Example = ({ value }: { value?: string }) => (
    <Select defaultValue={value}>
        <SelectTrigger aria-label="Manager">
            <SelectValue placeholder="Select a manager" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="ada">Ada</SelectItem>
            <SelectItem value="linus">Linus</SelectItem>
        </SelectContent>
    </Select>
);

describe("Select", () => {
    it("renders a labelled combobox trigger with the placeholder", () => {
        render(<Example />);
        const trigger = screen.getByRole("combobox", { name: "Manager" });
        expect(trigger).toHaveTextContent("Select a manager");
    });

    it("shows the selected option's label", () => {
        render(<Example value="ada" />);
        expect(
            screen.getByRole("combobox", { name: "Manager" })
        ).toHaveTextContent("Ada");
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Example />);
        expect(
            declaresTouchTarget(
                screen.getByRole("combobox", { name: "Manager" })
            )
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Example />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
