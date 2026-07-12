import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./tooltip";

expect.extend(toHaveNoViolations);

const Example = () => (
    <TooltipProvider>
        <Tooltip defaultOpen>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Helpful hint</TooltipContent>
        </Tooltip>
    </TooltipProvider>
);

describe("Tooltip", () => {
    it("renders trigger and tooltip content when open", () => {
        render(<Example />);
        expect(
            screen.getByRole("button", { name: "Hover me" })
        ).toBeInTheDocument();
        expect(screen.getAllByText("Helpful hint").length).toBeGreaterThan(0);
    });

    it("has no axe violations", async () => {
        const { baseElement } = render(<Example />);
        // `region` is a page-level landmark rule; irrelevant for an isolated
        // portalled primitive rendered outside a full page shell.
        expect(
            await axe(baseElement, { rules: { region: { enabled: false } } })
        ).toHaveNoViolations();
    });
});
