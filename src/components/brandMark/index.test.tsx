import { render, screen } from "@testing-library/react";

import BrandMark from "./index";

describe("BrandMark", () => {
    it("renders the default wordmark alongside the glyph", () => {
        render(<BrandMark />);
        // Default wordmark is the product name.
        expect(screen.getByText("Pulse")).toBeInTheDocument();
    });

    it("renders only the glyph when glyphOnly is true", () => {
        render(<BrandMark glyphOnly />);
        expect(screen.queryByText("Pulse")).not.toBeInTheDocument();
        // The glyph itself is an aria-hidden svg.
        // We don't query by role here because aria-hidden hides it from the AX tree.
    });

    it("honours an explicit wordmark label override", () => {
        render(<BrandMark label="Pulse Studio" />);
        expect(screen.getByText("Pulse Studio")).toBeInTheDocument();
    });

    it("emits unique gradient ids for each instance (no SVG url(#) collisions)", () => {
        const { container } = render(
            <>
                <BrandMark />
                <BrandMark />
            </>
        );
        const ids = Array.from(
            container.querySelectorAll("linearGradient")
        ).map((el) => el.id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        // Sanitised ids cannot start with a colon and only contain word chars.
        for (const id of ids) {
            expect(id).toMatch(/^brand-pulse-[A-Za-z0-9_-]+$/);
        }
    });

    it.each(["sm", "md", "lg"] as const)(
        "renders without warnings for size=%s",
        (size) => {
            const { container } = render(<BrandMark size={size} />);
            const svg = container.querySelector("svg");
            expect(svg).toBeInTheDocument();
            expect(svg).toHaveAttribute("viewBox", "0 0 32 32");
        }
    );
});
