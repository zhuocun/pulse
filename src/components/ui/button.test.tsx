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
        render(
            <Button disabled={false} loading>
                Save
            </Button>
        );
        const button = screen.getByRole("button", { name: /Save/ });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("aria-busy", "true");
        expect(button).toHaveClass("disabled:opacity-100");
        expect(button).not.toHaveClass("disabled:opacity-50");
        expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
    });

    it("keeps ordinary disabled controls dimmed", () => {
        render(<Button disabled>Unavailable</Button>);
        const button = screen.getByRole("button", { name: "Unavailable" });
        expect(button).toHaveClass("disabled:opacity-50");
        expect(button).not.toHaveAttribute("aria-busy");
    });

    it("declares a 44px coarse-pointer target in both dimensions", () => {
        render(<Button>Tap</Button>);
        const button = screen.getByRole("button", { name: "Tap" });
        expect(declaresTouchTarget(button)).toBe(true);
        expect(button).toHaveClass("coarse:min-w-[44px]");
    });

    it("keeps visible chrome under forced-colors for primary and default", () => {
        const { rerender } = render(<Button variant="primary">Log in</Button>);
        const primary = screen.getByRole("button", { name: "Log in" });
        expect(primary.className).toMatch(/forced-colors:border-\[ButtonText\]/);
        expect(primary.className).toMatch(/forced-colors:bg-\[ButtonFace\]/);

        rerender(<Button variant="default">Cancel</Button>);
        const secondary = screen.getByRole("button", { name: "Cancel" });
        expect(secondary.className).toMatch(/forced-colors:border-\[ButtonText\]/);
        expect(secondary.className).toMatch(/forced-colors:bg-\[ButtonFace\]/);
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
