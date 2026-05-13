/**
 * Regression: every absolute-positioned SR-only / aria-live region in the
 * app must declare `pointer-events: none`. The 1×1 clip hides them visually
 * but the absolute box still occupies a hit-test target above whatever it is
 * positioned over — without this rule, real buttons stacked behind them
 * (chat send, task modal fields, drawer chrome, auth submit) lose clicks.
 *
 * Companion to mainLayout.skipLink.strict.test.tsx and the orchestrator
 * fix-shell-overlay-clicks branch which hardened the command-palette and
 * board-filter announcers; this suite covers the remaining auth, search,
 * brief, assist, and chat live regions.
 */
import { render, screen } from "@testing-library/react";
import { Form } from "antd";
import { ReactNode } from "react";

jest.mock("../components/errorBox", () => ({
    __esModule: true,
    default: () => null,
    resolveAuthPageErrorMessage: (err: unknown) =>
        err instanceof Error ? err.message : null
}));

import AuthErrorSummary from "../components/authErrorSummary";

const FormWrapper = ({ children }: { children: ReactNode }) => (
    <Form>{children}</Form>
);

describe("SR-only / aria-live overlays declare pointer-events: none", () => {
    it("authErrorSummary SrOnly inside live alert is non-interactive", () => {
        render(
            <FormWrapper>
                <AuthErrorSummary
                    fields={[{ name: "email", id: "email", label: "Email" }]}
                    includeFieldErrors={false}
                    serverError={new Error("Boom")}
                />
            </FormWrapper>
        );
        const alert = screen.getByRole("alert");
        const srOnly = alert.querySelector("#auth-error-summary-sr-only");
        expect(srOnly).not.toBeNull();
        expect(srOnly).toHaveStyle({ pointerEvents: "none" });
    });
});
