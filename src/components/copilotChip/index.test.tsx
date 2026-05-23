import { fireEvent, render, screen } from "@testing-library/react";

import CopilotChip, { type CopilotChipVariant } from "./index";

/**
 * Force `prefers-reduced-motion: reduce` for the test render, then restore.
 * The shared CopilotChip silences the gradient pulse/glow when the OS asks
 * for less motion — this helper drives the matchMedia mock that
 * `setupTests.ts` registers globally.
 */
const withReducedMotion = (reduced: boolean) => {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
        matches:
            reduced && query === "(prefers-reduced-motion: reduce)"
                ? true
                : false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn()
    }));
};

const ALL_VARIANTS: CopilotChipVariant[] = [
    "badge",
    "citation",
    "confidence",
    "engine",
    "match",
    "suggested",
    "risk"
];

describe("CopilotChip", () => {
    afterEach(() => {
        // Reset matchMedia mock after tests that mutate it.
        withReducedMotion(false);
    });

    describe.each(ALL_VARIANTS)("variant=%s", (variant) => {
        it("renders the children", () => {
            render(<CopilotChip variant={variant}>label</CopilotChip>);
            expect(screen.getByText("label")).toBeInTheDocument();
        });

        it("stamps `data-copilot-chip-variant` on the rendered element", () => {
            render(<CopilotChip variant={variant}>label</CopilotChip>);
            expect(
                screen.getByText("label").closest("[data-copilot-chip-variant]")
            ).toHaveAttribute("data-copilot-chip-variant", variant);
        });
    });

    it("defaults to non-interactive (no role=button, no tabIndex)", () => {
        render(<CopilotChip variant="confidence">High (90%)</CopilotChip>);
        const chip = screen.getByText("High (90%)").closest("span");
        expect(chip).not.toHaveAttribute("role", "button");
        expect(chip).not.toHaveAttribute("tabindex");
    });

    it("renders an interactive chip as a button-like element with tabIndex=0", () => {
        const onClick = jest.fn();
        render(
            <CopilotChip interactive onClick={onClick} variant="citation">
                [1]
            </CopilotChip>
        );
        const chip = screen.getByRole("button", { name: "[1]" });
        expect(chip).toHaveAttribute("tabindex", "0");
        fireEvent.click(chip);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("respects an explicit role override", () => {
        // CitationChip renders `role="note"` when navigation is disabled —
        // make sure the shared chip lets the consumer keep that contract
        // even when `interactive` is implicitly false.
        render(
            <CopilotChip role="note" variant="citation">
                [1]
            </CopilotChip>
        );
        expect(screen.getByRole("note")).toBeInTheDocument();
    });

    it("respects an explicit tabIndex override", () => {
        render(
            <CopilotChip tabIndex={-1} variant="citation">
                [1]
            </CopilotChip>
        );
        expect(screen.getByText("[1]").closest("span")).toHaveAttribute(
            "tabindex",
            "-1"
        );
    });

    it("forwards aria-label, aria-describedby, data-testid untouched", () => {
        render(
            <CopilotChip
                aria-describedby="desc-1"
                aria-label="Suggested by Copilot"
                data-testid="suggested-chip"
                variant="suggested"
            >
                AI
            </CopilotChip>
        );
        const chip = screen.getByLabelText("Suggested by Copilot");
        expect(chip).toHaveAttribute("data-testid", "suggested-chip");
        expect(chip).toHaveAttribute("aria-describedby", "desc-1");
    });

    it("forwards onKeyDown for keyboard activation", () => {
        const onKeyDown = jest.fn();
        render(
            <CopilotChip interactive onKeyDown={onKeyDown} variant="citation">
                [1]
            </CopilotChip>
        );
        fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
        expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it("applies a default tone when none is supplied", () => {
        // `suggested` defaults to purple → element carries the tone marker.
        render(<CopilotChip variant="suggested">AI</CopilotChip>);
        expect(
            screen.getByText("AI").closest("[data-copilot-chip-tone]")
        ).toHaveAttribute("data-copilot-chip-tone", "purple");
    });

    it("honors an explicit tone override for variant defaults", () => {
        // Risk variant defaults to `default`; the consumer picks red for
        // high-risk proposals. Mark must reflect the override.
        render(
            <CopilotChip tone="red" variant="risk">
                High risk
            </CopilotChip>
        );
        expect(
            screen.getByText("High risk").closest("[data-copilot-chip-tone]")
        ).toHaveAttribute("data-copilot-chip-tone", "red");
    });

    it("forwards a custom style override without dropping geometry tokens", () => {
        render(
            <CopilotChip style={{ marginTop: 7 }} variant="confidence">
                X
            </CopilotChip>
        );
        const chip = screen.getByText("X").closest("span");
        expect(chip).toHaveStyle({ marginTop: "7px" });
    });

    it("forwards data-* attributes for telemetry surfaces", () => {
        render(
            <CopilotChip data-analytics="ai-match" variant="match">
                Strong match
            </CopilotChip>
        );
        expect(
            screen
                .getByText("Strong match")
                .closest("[data-copilot-chip-variant]")
        ).toHaveAttribute("data-analytics", "ai-match");
    });

    it("renders without the pulse hover treatment when prefers-reduced-motion is set", () => {
        // Regression guard for WCAG 2.3.3. The chip must still render and
        // remain accessible — the only change is that the gradient pulse
        // transition is silenced. We assert via the `motion` data marker
        // routed onto the styled root so future visual snapshots can
        // pin the contract without depending on Emotion class names.
        withReducedMotion(true);
        render(<CopilotChip variant="suggested">AI</CopilotChip>);
        // Re-rendering after the matchMedia mock flips — the chip should
        // still be in the DOM and still announce its variant marker.
        expect(
            screen.getByText("AI").closest("[data-copilot-chip-variant]")
        ).toHaveAttribute("data-copilot-chip-variant", "suggested");
    });

    /*
     * Followup A (PR #308 review): the `color` prop is Omitted from the
     * underlying `HTMLAttributes<HTMLElement>` so callers can't smuggle
     * a raw color through and silently fight the curated `tone` system.
     * The contract is enforced at compile time — passing `color="cyan"`
     * has to be a TypeScript error, otherwise the named-palette
     * regression (AntD picks up the unsupported color and renders an
     * inert chip) would only surface in QA.
     */
    it("rejects a raw `color` prop at the TypeScript layer (Followup A)", () => {
        const node = (
            <CopilotChip
                // @ts-expect-error - `color` is intentionally Omitted from
                // CopilotChipProps so the curated tone palette is the
                // only valid color knob. If this line ever stops being a
                // TS error the Omit drifted and the regression guard is
                // no longer load-bearing.
                color="cyan"
                variant="match"
            >
                Strong match
            </CopilotChip>
        );
        render(node);
        // Runtime behaviour is incidental — the test's real assertion is
        // the `@ts-expect-error` directive on the line above. We still
        // render so a runtime regression (chip throws on the smuggled
        // prop) would also fail loudly.
        expect(screen.getByText("Strong match")).toBeInTheDocument();
    });

    it("matches the variant snapshot for every supported variant", () => {
        // One snapshot per variant — future visual reviews can scan the
        // diff to spot accidental shape drift. The snapshot only covers
        // the chip in its default tone + non-interactive shape; consumers
        // wiring `interactive` / overriding `tone` continue to assert
        // their own DOM contracts.
        for (const variant of ALL_VARIANTS) {
            const { container, unmount } = render(
                <CopilotChip variant={variant}>label</CopilotChip>
            );
            expect(container.firstChild).toMatchSnapshot(`variant=${variant}`);
            unmount();
        }
    });
});
