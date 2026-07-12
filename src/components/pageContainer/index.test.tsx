import { render, screen } from "@testing-library/react";

import PageContainer from ".";

describe("PageContainer", () => {
    it("renders children inside the padded full-width container", () => {
        render(
            <PageContainer data-testid="page-container">
                <h1>Projects</h1>
            </PageContainer>
        );

        expect(
            screen.getByRole("heading", { name: "Projects" })
        ).toBeInTheDocument();
        expect(screen.getByTestId("page-container")).toHaveClass("w-full");
    });
});
