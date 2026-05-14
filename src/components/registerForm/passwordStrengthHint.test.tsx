import { render, screen } from "@testing-library/react";

import { PasswordStrengthHint } from "./passwordStrengthHint";

describe("PasswordStrengthHint", () => {
    it("renders nothing for an empty password", () => {
        const { container } = render(<PasswordStrengthHint password="" />);
        expect(container).toBeEmptyDOMElement();
    });

    it("announces a too-short password via the polite status region", () => {
        render(<PasswordStrengthHint password="Ab1!" />);
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent(/too short/i);
        expect(status).toHaveAttribute("aria-live", "polite");
        expect(status.getAttribute("aria-label") ?? "").toMatch(/too short/i);
    });

    it("announces a weak password when only one character class is present", () => {
        render(<PasswordStrengthHint password="abcdefgh" />);
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent(/weak/i);
    });

    it("announces a fair password for mixed classes under 10 chars", () => {
        render(<PasswordStrengthHint password="Abc12345" />);
        expect(screen.getByRole("status")).toHaveTextContent(/fair/i);
    });

    it("announces a strong password for 10+ chars with 3 classes", () => {
        render(<PasswordStrengthHint password="Abcdef!@#1" />);
        expect(screen.getByRole("status")).toHaveTextContent(/strong/i);
    });
});
