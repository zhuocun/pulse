import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import TermsPage from ".";

describe("TermsPage", () => {
    it("surfaces localized legal-placeholder copy under the Terms heading", () => {
        render(
            <BrowserRouter>
                <TermsPage />
            </BrowserRouter>
        );

        expect(
            screen.getByRole("heading", { name: /^terms of service$/i })
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                /this deployment does not yet host standalone legal text/i
            )
        ).toBeInTheDocument();
    });
});
