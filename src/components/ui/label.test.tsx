import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Input } from "./input";
import { Label } from "./label";

expect.extend(toHaveNoViolations);

describe("Label", () => {
    it("associates with a control via htmlFor", () => {
        render(
            <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" />
            </div>
        );
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" />
            </div>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
