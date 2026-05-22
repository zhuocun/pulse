import { render, screen } from "@testing-library/react";

import AiSparkleIcon from "./index";

describe("AiSparkleIcon", () => {
    it("renders as decorative when aria-hidden is set", () => {
        render(<AiSparkleIcon aria-hidden />);
        // Decorative icons have no role of img and no name in the AX tree.
        expect(screen.queryByRole("img")).toBeNull();
        const svg = document.querySelector("svg");
        expect(svg).toBeTruthy();
        expect(svg!.getAttribute("aria-hidden")).toBe("true");
        expect(svg!.hasAttribute("aria-label")).toBe(false);
    });

    it("uses the provided aria-label as the accessible name when not hidden", () => {
        render(<AiSparkleIcon aria-label="Copilot brief" />);
        expect(screen.getByLabelText("Copilot brief")).toBeInTheDocument();
        expect(screen.getByRole("img")).toBeInTheDocument();
    });

    it("does not leak a default 'Board Copilot' name when used decoratively", () => {
        // Regression guard for the QW-15 bug: previously a forgotten
        // `aria-hidden` resulted in screen readers announcing
        // "Board Copilot, <button-name>". With the discriminated union
        // there is no longer any default name to leak.
        render(<AiSparkleIcon aria-hidden />);
        expect(screen.queryByLabelText("Board Copilot")).toBeNull();
    });

    it("emits CSS-variable stops without a brand-orange literal fallback", () => {
        // Visual flash regression (QW-15 follow-on). On non-orange
        // palettes the icon used to render a brand-orange paint for one
        // frame before the CSS variables resolved. The fix removes the
        // inline `#EA580C` fallback so the gradient hydrates cleanly.
        render(<AiSparkleIcon aria-hidden />);
        const stops = document.querySelectorAll("stop");
        expect(stops.length).toBeGreaterThan(0);
        stops.forEach((stop) => {
            const color = stop.getAttribute("stop-color") ?? "";
            expect(color).not.toMatch(/#EA580C/i);
            expect(color).not.toMatch(/#F97316/i);
            expect(color).toContain("var(--color-copilot-grad");
        });
    });
});
