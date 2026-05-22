import { render, screen } from "@testing-library/react";

import SrOnlyLive from "./SrOnlyLive";

describe("SrOnlyLive", () => {
    it("renders children with the polite/status defaults", () => {
        render(<SrOnlyLive>Loading data</SrOnlyLive>);

        const region = screen.getByRole("status");
        expect(region).toHaveAttribute("aria-live", "polite");
        expect(region).toHaveAttribute("aria-atomic", "true");
        expect(region).toHaveTextContent("Loading data");
    });

    it("honors assertive announcements when requested", () => {
        render(
            <SrOnlyLive aria-live="assertive" role="alert">
                Boom
            </SrOnlyLive>
        );

        const region = screen.getByRole("alert");
        expect(region).toHaveAttribute("aria-live", "assertive");
        expect(region).toHaveTextContent("Boom");
    });

    it("applies the visually-hidden style (1×1 clipped absolute box)", () => {
        // The live region must not take layout space or intercept clicks,
        // so the shared `srOnlyLiveRegionStyle` mixin paints the
        // standard visually-hidden contract: 1px box, clipped rectangle,
        // position absolute, overflow hidden, pointer-events none.
        render(<SrOnlyLive>Announce</SrOnlyLive>);

        const region = screen.getByRole("status");
        expect(region).toHaveStyle({
            position: "absolute",
            overflow: "hidden",
            width: "1px",
            height: "1px",
            clip: "rect(0 0 0 0)",
            pointerEvents: "none"
        });
    });

    it("respects aria-atomic=false when explicitly disabled", () => {
        render(<SrOnlyLive aria-atomic={false}>Incremental update</SrOnlyLive>);

        const region = screen.getByRole("status");
        expect(region).toHaveAttribute("aria-atomic", "false");
    });
});
