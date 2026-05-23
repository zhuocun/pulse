import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import EmptyState from ".";

expect.extend(toHaveNoViolations);

describe("EmptyState", () => {
    it("renders title, description, and CTA", () => {
        render(
            <EmptyState
                cta={<button type="button">Create one</button>}
                description="Get started by creating your first project."
                title="No projects yet"
            />
        );

        expect(
            screen.getByRole("heading", { name: /no projects yet/i })
        ).toBeInTheDocument();
        expect(
            screen.getByText(/get started by creating your first project/i)
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /create one/i })
        ).toBeInTheDocument();
    });

    it("falls back to the branded illustration when no override is given", () => {
        const { container } = render(<EmptyState title="Nothing here" />);
        // The branded illustration is an inline <svg>; the previous AntD
        // Empty class hook has been replaced.
        expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("has no axe-detectable accessibility violations", async () => {
        const { container } = render(
            <EmptyState description="Try again later." title="No tasks" />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    describe("tone → role mapping", () => {
        it("defaults to role=status (backwards-compatible with the prior unconditional announce)", () => {
            render(<EmptyState data-testid="es" title="No tasks" />);
            expect(screen.getByTestId("es")).toHaveAttribute("role", "status");
        });

        it("tone='empty' renders role=status", () => {
            render(<EmptyState data-testid="es" title="Empty" tone="empty" />);
            expect(screen.getByTestId("es")).toHaveAttribute("role", "status");
        });

        it("tone='loading' renders role=status (polite announce)", () => {
            render(
                <EmptyState data-testid="es" title="Loading" tone="loading" />
            );
            expect(screen.getByTestId("es")).toHaveAttribute("role", "status");
        });

        it("tone='error' renders role=alert (assertive announce)", () => {
            render(
                <EmptyState
                    data-testid="es"
                    title="Something went wrong"
                    tone="error"
                />
            );
            expect(screen.getByTestId("es")).toHaveAttribute("role", "alert");
        });

        it("tone='notice' renders without a live-region role", () => {
            render(
                <EmptyState
                    data-testid="es"
                    title="AI is disabled"
                    tone="notice"
                />
            );
            expect(screen.getByTestId("es")).not.toHaveAttribute("role");
        });

        it("tone='notFound' renders without a live-region role", () => {
            render(
                <EmptyState
                    data-testid="es"
                    title="Page not found"
                    tone="notFound"
                />
            );
            expect(screen.getByTestId("es")).not.toHaveAttribute("role");
        });
    });
});
