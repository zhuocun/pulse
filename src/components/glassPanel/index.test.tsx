import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";

import GlassPanel from "./index";

expect.extend(toHaveNoViolations);

describe("GlassPanel", () => {
    it("renders its children", () => {
        const { getByText } = render(
            <GlassPanel>
                <span>inner content</span>
            </GlassPanel>
        );
        expect(getByText("inner content")).toBeInTheDocument();
    });

    it("forwards refs to the underlying root element", () => {
        const ref = React.createRef<HTMLDivElement>();
        render(<GlassPanel ref={ref}>ref target</GlassPanel>);
        expect(ref.current).not.toBeNull();
        expect(ref.current?.tagName).toBe("DIV");
    });

    describe("intensity", () => {
        it("defaults to `regular` when no intensity is given", () => {
            const { container } = render(<GlassPanel>x</GlassPanel>);
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassIntensity).toBe("regular");
        });

        it("emits a data attribute for `strong`", () => {
            const { container } = render(
                <GlassPanel intensity="strong">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassIntensity).toBe("strong");
        });

        it("emits a data attribute for `regular`", () => {
            const { container } = render(
                <GlassPanel intensity="regular">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassIntensity).toBe("regular");
        });

        it("emits a data attribute for `subtle`", () => {
            const { container } = render(
                <GlassPanel intensity="subtle">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassIntensity).toBe("subtle");
        });
    });

    describe("tone", () => {
        it("defaults to `neutral` when no tone is given", () => {
            const { container } = render(<GlassPanel>x</GlassPanel>);
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassTone).toBe("neutral");
        });

        it("emits a data attribute for `neutral`", () => {
            const { container } = render(
                <GlassPanel tone="neutral">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassTone).toBe("neutral");
        });

        it("emits a data attribute for `aurora`", () => {
            const { container } = render(
                <GlassPanel tone="aurora">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassTone).toBe("aurora");
        });

        it("emits a data attribute for `accent`", () => {
            const { container } = render(
                <GlassPanel tone="accent">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassTone).toBe("accent");
        });
    });

    describe("polymorphic `as` prop", () => {
        it("renders as a div by default", () => {
            const { container } = render(<GlassPanel>x</GlassPanel>);
            const root = container.firstElementChild as HTMLElement;
            expect(root.tagName).toBe("DIV");
        });

        it("renders as a `section` when `as=section` is passed", () => {
            const { container } = render(
                <GlassPanel as="section">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.tagName).toBe("SECTION");
        });

        it("renders as an `aside` when `as=aside` is passed", () => {
            const { container } = render(<GlassPanel as="aside">x</GlassPanel>);
            const root = container.firstElementChild as HTMLElement;
            expect(root.tagName).toBe("ASIDE");
        });
    });

    describe("className composition", () => {
        it("composes the consumer className with the styled-component class", () => {
            const { container } = render(
                <GlassPanel className="from-consumer">x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            // Consumer class is present
            expect(root.classList.contains("from-consumer")).toBe(true);
            // Emotion always adds a generated className — verify the
            // styled root has more than one class so we know we're not
            // dropping the styled-component's painting.
            expect(root.className.split(" ").length).toBeGreaterThan(1);
        });
    });

    describe("glass-on-glass collision marker", () => {
        it("emits `data-glass-context=true` so Wave 3 overlays can detect a glass ancestor", () => {
            const { container } = render(<GlassPanel>x</GlassPanel>);
            const root = container.firstElementChild as HTMLElement;
            expect(root.dataset.glassContext).toBe("true");
        });
    });

    describe("HTML attribute forwarding", () => {
        it("forwards data-*, aria-*, and id attributes onto the root", () => {
            const { container } = render(
                <GlassPanel
                    aria-label="frosted region"
                    data-testid="my-panel"
                    id="panel-root"
                >
                    x
                </GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.id).toBe("panel-root");
            expect(root.getAttribute("data-testid")).toBe("my-panel");
            expect(root.getAttribute("aria-label")).toBe("frosted region");
        });

        it("merges the consumer style onto the styled root", () => {
            const { container } = render(
                <GlassPanel style={{ marginTop: 24 }}>x</GlassPanel>
            );
            const root = container.firstElementChild as HTMLElement;
            expect(root.style.marginTop).toBe("24px");
        });
    });

    describe("accessibility", () => {
        it("has no axe-detectable accessibility violations on its own", async () => {
            const { container } = render(
                <GlassPanel aria-label="frosted region">
                    <p>Glass content with crisp text inside a child node.</p>
                </GlassPanel>
            );
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });

        it("has no axe-detectable accessibility violations as a section landmark", async () => {
            const { container } = render(
                <GlassPanel
                    aria-label="copilot summary"
                    as="section"
                    intensity="strong"
                    tone="aurora"
                >
                    <h2>Section heading</h2>
                    <p>Section body copy.</p>
                </GlassPanel>
            );
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });
});
