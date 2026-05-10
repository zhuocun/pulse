import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import ForgotPasswordPage from ".";

describe("ForgotPasswordPage", () => {
    it("renders the placeholder title and body copy", () => {
        render(
            <BrowserRouter>
                <ForgotPasswordPage />
            </BrowserRouter>
        );

        expect(
            screen.getByRole("heading", { name: /reset your password/i })
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                /password reset is coming soon\. please contact your workspace admin if you need immediate access\./i
            )
        ).toBeInTheDocument();
    });
});
