import { render, screen } from "@testing-library/react";

import Row from ".";

describe("Row", () => {
    it("applies flex layout, space-between alignment, and bottom margin", () => {
        render(
            <Row data-testid="row" between marginBottom={3}>
                <span>Left</span>
                <span>Right</span>
            </Row>
        );

        const row = screen.getByTestId("row");
        expect(row).toHaveClass("flex", "items-center", "justify-between");
        expect(row).toHaveStyle({ marginBottom: "3rem" });
    });

    it("uses a numeric gap between child elements", () => {
        render(
            <Row gap={1.5}>
                <span data-testid="first-child">First</span>
                <span>Second</span>
            </Row>
        );

        expect(screen.getByTestId("first-child")).toHaveStyle({
            marginRight: "1.5rem",
            marginTop: "0px",
            marginBottom: "0px"
        });
    });

    it("uses the default spacing when gap is true", () => {
        render(
            <Row gap>
                <span data-testid="first-child">First</span>
                <span>Second</span>
            </Row>
        );

        expect(screen.getByTestId("first-child")).toHaveStyle({
            marginRight: "2rem"
        });
    });
});
