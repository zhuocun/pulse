import { render } from "@testing-library/react";

import EmptyIllustration from "./index";

const variantSelectors = {
    tasks: "rect", // checklist rectangle
    projects: "rect", // browser-frame rectangle
    search: "circle", // magnifying glass circle
    members: "circle" // member head circle
} as const;

describe("EmptyIllustration", () => {
    it("renders an aria-hidden svg so it doesn't pollute the AX tree", () => {
        const { container } = render(<EmptyIllustration />);
        const svg = container.querySelector("svg");
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg).toHaveAttribute("focusable", "false");
    });

    it("defaults to a 56-CSS-pixel square", () => {
        const { container } = render(<EmptyIllustration />);
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("width")).toBe("56");
        expect(svg.getAttribute("height")).toBe("56");
    });

    it.each(
        Object.keys(variantSelectors) as Array<keyof typeof variantSelectors>
    )("renders the %s silhouette for the matching variant", (variant) => {
        const { container } = render(<EmptyIllustration variant={variant} />);
        const shape = container.querySelector(variantSelectors[variant]);
        expect(shape).toBeInTheDocument();
    });

    it("emits unique gradient ids across multiple instances", () => {
        const { container } = render(
            <>
                <EmptyIllustration variant="tasks" />
                <EmptyIllustration variant="projects" />
            </>
        );
        const ids = Array.from(
            container.querySelectorAll("linearGradient, radialGradient")
        ).map((el) => el.id);
        expect(ids.length).toBeGreaterThanOrEqual(4);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("propagates a custom size to width/height attributes", () => {
        const { container } = render(<EmptyIllustration size={120} />);
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("width")).toBe("120");
        expect(svg.getAttribute("height")).toBe("120");
    });
});
