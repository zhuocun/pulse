import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Typography } from "./typography";

expect.extend(toHaveNoViolations);

describe("Typography", () => {
    it("renders Title at the requested heading level", () => {
        render(<Typography.Title level={3}>Projects</Typography.Title>);
        const heading = screen.getByRole("heading", { name: "Projects" });
        expect(heading.tagName).toBe("H3");
    });

    it("renders Text and Paragraph content", () => {
        render(
            <div>
                <Typography.Text type="secondary">Muted</Typography.Text>
                <Typography.Paragraph>Body copy</Typography.Paragraph>
            </div>
        );
        expect(screen.getByText("Muted")).toBeInTheDocument();
        expect(screen.getByText("Body copy")).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <div>
                <Typography.Title level={2}>Title</Typography.Title>
                <Typography.Paragraph>Paragraph</Typography.Paragraph>
            </div>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
