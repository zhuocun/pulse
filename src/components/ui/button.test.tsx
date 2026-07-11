import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Button } from "./button";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

describe("Button", () => {
    it("renders its label from children (never a baked-in string)", () => {
        render(<Button>Log in</Button>);
        expect(
            screen.getByRole("button", { name: "Log in" })
        ).toBeInTheDocument();
    });

    it("renders as its child element when asChild is set", () => {
        render(
            <Button asChild>
                <a href="/projects">Go</a>
            </Button>
        );
        const link = screen.getByRole("link", { name: "Go" });
        expect(link).toHaveAttribute("href", "/projects");
    });

    it("shows a spinner, marks aria-busy, and disables while loading", () => {
        render(<Button loading>Save</Button>);
        const button = screen.getByRole("button", { name: /Save/ });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("aria-busy", "true");
        expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Button>Tap</Button>);
        expect(
            declaresTouchTarget(screen.getByRole("button", { name: "Tap" }))
        ).toBe(true);
    });

    it("has no axe violations across variants", async () => {
        const { container } = render(
            <div>
                <Button variant="primary">Primary</Button>
                <Button variant="destructive">Delete</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button aria-label="Close icon" size="icon">
                    <svg aria-hidden viewBox="0 0 1 1" />
                </Button>
            </div>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
