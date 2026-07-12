import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AUTH_TERMS_PATH } from "../../constants/authPaths";

import { AuthTermsAgreement } from "./termsAgreement";

const renderInRouter = (ui: React.ReactElement) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

describe("AuthTermsAgreement", () => {
    it("uses the login copy when variant='login'", () => {
        renderInRouter(<AuthTermsAgreement variant="login" />);
        // Login prefix renders as plain text, distinct from the register prefix.
        expect(screen.getByText(/by signing in, you agree/i)).toBeVisible();
        expect(
            screen.queryByText(/by signing up, you agree/i)
        ).not.toBeInTheDocument();
    });

    it("uses the register copy when variant='register'", () => {
        renderInRouter(<AuthTermsAgreement variant="register" />);
        expect(screen.getByText(/by signing up, you agree/i)).toBeVisible();
        expect(
            screen.queryByText(/by signing in, you agree/i)
        ).not.toBeInTheDocument();
    });

    it("links to the terms page using AUTH_TERMS_PATH", () => {
        renderInRouter(<AuthTermsAgreement variant="register" />);
        const link = screen.getByRole("link", { name: /terms of service/i });
        expect(link).toHaveAttribute("href", `/${AUTH_TERMS_PATH}`);
        expect(link).toHaveClass("coarse:inline-flex");
        expect(link).toHaveClass("coarse:min-h-[44px]");
        expect(link).toHaveClass("coarse:items-center");
    });
});
