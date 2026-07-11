import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "./dropdown-menu";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

const Example = () => (
    <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Log out</DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
);

describe("DropdownMenu", () => {
    it("renders menu items when open", () => {
        render(<Example />);
        expect(
            screen.getByRole("menuitem", { name: "Settings" })
        ).toBeInTheDocument();
    });

    it("declares a touch-target height of at least 44px on items (WCAG 2.5.8)", () => {
        render(<Example />);
        expect(
            declaresTouchTarget(
                screen.getByRole("menuitem", { name: "Log out" })
            )
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { baseElement } = render(<Example />);
        // `region` is a page-level landmark rule; irrelevant for an isolated
        // portalled menu rendered outside a full page shell.
        expect(
            await axe(baseElement, { rules: { region: { enabled: false } } })
        ).toHaveNoViolations();
    });
});
