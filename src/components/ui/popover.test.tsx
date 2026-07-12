import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";

expect.extend(toHaveNoViolations);

const Example = () => (
    <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent aria-label="Details">
            <p>Popover body</p>
        </PopoverContent>
    </Popover>
);

describe("Popover", () => {
    it("renders its content when open", () => {
        render(<Example />);
        expect(screen.getByText("Popover body")).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { baseElement } = render(<Example />);
        // `region` is a page-level landmark rule; irrelevant for an isolated
        // portalled popover rendered outside a full page shell.
        expect(
            await axe(baseElement, { rules: { region: { enabled: false } } })
        ).toHaveNoViolations();
    });
});
