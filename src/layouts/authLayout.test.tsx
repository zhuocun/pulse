import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import AuthLayout, { AuthButton } from "./authLayout";

const renderLayout = () =>
    render(
        <MemoryRouter initialEntries={["/login"]}>
            <Routes>
                <Route element={<AuthLayout />}>
                    <Route
                        path="/login"
                        element={<div>Login outlet content</div>}
                    />
                </Route>
            </Routes>
        </MemoryRouter>
    );

describe("AuthLayout", () => {
    it("renders the auth shell with outlet content", () => {
        const { container } = renderLayout();

        expect(screen.getByText("Login outlet content")).toBeInTheDocument();
        expect(container.querySelector("header")).toBeInTheDocument();
        expect(container.querySelector("main")).toBeInTheDocument();
        expect(
            container.querySelector('[data-glass-context="true"]')
        ).toBeInTheDocument();
    });

    // Tailwind's compiled stylesheet isn't loaded in jsdom, so the recipe is
    // verified by the utilities threaded onto the rendered elements rather than
    // by resolving computed styles (which would return empty here).
    it("caps the form card at a fluid 40rem width", () => {
        const { container } = renderLayout();

        const card = container.querySelector(
            '[data-glass-context="true"]'
        ) as HTMLElement;
        expect(card).toBeTruthy();
        expect(card.className).toContain("max-w-[40rem]");
        expect(card.className).toContain("w-[min(40rem,100%-2rem)]");
    });

    it("exports a full-width auth button", () => {
        render(<AuthButton>Continue</AuthButton>);

        const button = screen.getByRole("button", { name: /continue/i });
        expect(button.className).toContain("w-full");
    });

    // WCAG 2.5.8 (Target Size). The dominant mobile CTA must stay generous:
    // the primitive `Button` threads the `coarse:min-h-[44px]` floor and the
    // AuthButton pins an explicit 44px (`h-11`) height on every pointer.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        render(<AuthButton>Continue</AuthButton>);
        const button = screen.getByRole("button", { name: /continue/i });

        expect(button.className).toContain("h-11");
        expect(button.className).toContain("coarse:min-h-[44px]");
    });

    /*
     * Liquid Glass chrome recipe. The auth FormCard is the strongest glass
     * surface in the app (strong surface + heavy blur + brand-tinted border),
     * so it carries the specular-rim recipe and the `data-glass-context`
     * marker, and the AuthButton carries the gel-flex press transform.
     */
    describe("Liquid Glass chrome recipe", () => {
        const cardClass = () => {
            const { container } = renderLayout();
            return (
                container.querySelector(
                    '[data-glass-context="true"]'
                ) as HTMLElement
            ).className;
        };

        it('marks the FormCard root with data-glass-context="true"', () => {
            const { container } = renderLayout();
            const card = container.querySelector('[data-glass-context="true"]');
            expect(card).not.toBeNull();
            expect(card?.getAttribute("data-glass-context")).toBe("true");
        });

        it("emits a ::before specular-rim layer with --glass-specular-top", () => {
            expect(cardClass()).toContain(
                "before:[background:var(--glass-specular-top)]"
            );
        });

        it("emits a ::after companion layer with --glass-specular-bottom", () => {
            expect(cardClass()).toContain(
                "after:[background:var(--glass-specular-bottom)]"
            );
        });

        it("applies the gel-flex transform recipe to AuthButton", () => {
            render(<AuthButton>Continue</AuthButton>);
            const { className } = screen.getByRole("button", {
                name: /continue/i
            });
            expect(className).toContain("var(--motion-gel-flex");
            expect(className).toContain("active:scale-[0.97]");
        });

        it("neutralizes the AuthButton transition + active scale under prefers-reduced-motion", () => {
            render(<AuthButton>Continue</AuthButton>);
            const { className } = screen.getByRole("button", {
                name: /continue/i
            });
            expect(className).toContain("motion-reduce:[transition:none]");
            expect(className).toContain("motion-reduce:active:scale-100");
        });

        it("drops the FormCard rim under prefers-reduced-transparency", () => {
            expect(cardClass()).toContain(
                "[@media(prefers-reduced-transparency:reduce)]:before:[background:none]"
            );
        });

        it("drops the FormCard rim under forced-colors (Windows high-contrast)", () => {
            expect(cardClass()).toContain(
                "forced-colors:before:[background:none]"
            );
        });
    });
});
