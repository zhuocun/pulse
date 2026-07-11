import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Spinner } from "./spinner";

expect.extend(toHaveNoViolations);

describe("Spinner", () => {
    it("exposes an accessible status region with a label", () => {
        render(<Spinner label="Loading project" />);
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("Loading project");
    });

    it("has no axe violations", async () => {
        const { container } = render(<Spinner label="Loading" />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
