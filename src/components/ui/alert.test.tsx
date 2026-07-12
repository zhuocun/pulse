import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Alert, AlertDescription, AlertTitle } from "./alert";

expect.extend(toHaveNoViolations);

describe("Alert", () => {
    it("renders as an alert region with title and description", () => {
        render(
            <Alert variant="destructive">
                <AlertTitle>Save failed</AlertTitle>
                <AlertDescription>Try again.</AlertDescription>
            </Alert>
        );
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("Save failed");
        expect(alert).toHaveTextContent("Try again.");
    });

    it("has no axe violations across variants", async () => {
        const { container } = render(
            <div>
                <Alert>
                    <AlertTitle>Default</AlertTitle>
                </Alert>
                <Alert variant="success">
                    <AlertTitle>Saved</AlertTitle>
                </Alert>
                <Alert variant="warning">
                    <AlertTitle>Heads up</AlertTitle>
                </Alert>
            </div>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
