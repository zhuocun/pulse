import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Badge } from "./badge";

expect.extend(toHaveNoViolations);

describe("Badge", () => {
    it("renders its content", () => {
        render(<Badge>Bug</Badge>);
        expect(screen.getByText("Bug")).toBeInTheDocument();
    });

    it("has no axe violations across variants", async () => {
        const { container } = render(
            <div>
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Blocked</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="success">Done</Badge>
            </div>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
