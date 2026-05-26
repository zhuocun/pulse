import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form, Input } from "antd";
import type { FormInstance } from "antd";

import AuthErrorSummary, { type AuthErrorFieldMeta } from "./index";

const fields: readonly AuthErrorFieldMeta[] = [
    { name: "email", id: "auth-email", label: "Email" },
    { name: "password", id: "auth-password", label: "Password" }
];

type HarnessProps = {
    serverError?: Error | null;
    includeFieldErrors?: boolean;
    fieldErrors?: Array<{ name: string; errors: string[] }>;
    formRef?: (form: FormInstance) => void;
};

const Harness = ({
    serverError = null,
    includeFieldErrors = true,
    fieldErrors,
    formRef
}: HarnessProps) => {
    const [form] = Form.useForm();
    if (fieldErrors) {
        form.setFields(fieldErrors);
    }
    if (formRef) formRef(form);
    return (
        <Form form={form}>
            <AuthErrorSummary
                fields={fields}
                includeFieldErrors={includeFieldErrors}
                serverError={serverError}
            />
            <Form.Item name="email">
                <Input id="auth-email" />
            </Form.Item>
            <Form.Item name="password">
                <Input id="auth-password" />
            </Form.Item>
        </Form>
    );
};

describe("AuthErrorSummary", () => {
    it("renders nothing when there are no errors", () => {
        render(<Harness />);
        expect(screen.queryByRole("group")).not.toBeInTheDocument();
    });

    it("surfaces a server error message in the summary", () => {
        render(<Harness serverError={new Error("Invalid credentials")} />);
        const summary = screen.getByRole("group");
        expect(summary).toHaveTextContent(/invalid credentials/i);
    });

    it("focuses the summary when it becomes visible", () => {
        render(<Harness serverError={new Error("Server down")} />);
        const summary = screen.getByRole("group");
        expect(document.activeElement).toBe(summary);
    });

    it("does not re-steal focus when field errors update while the summary stays visible", () => {
        // The previous implementation depended on ``fieldErrors.length``
        // so every mid-type validation rerun ran ``ref.current.focus()``,
        // dismissing the iOS keyboard between keystrokes. Focus must move
        // exactly once per visibility transition (hidden -> visible).
        let captured: FormInstance | null = null;
        const { rerender } = render(
            <Harness
                formRef={(form) => {
                    captured = form;
                }}
            />
        );
        act(() => {
            captured!.setFields([
                { name: "email", errors: ["Email is required"] }
            ]);
        });
        const summary = screen.getByRole("group");
        const focusSpy = jest.spyOn(summary, "focus");

        // Subsequent validation passes the user typing into the field
        // would trigger should not re-focus the summary.
        act(() => {
            captured!.setFields([
                {
                    name: "email",
                    errors: ["Email is required", "Email must be valid"]
                }
            ]);
        });
        rerender(
            <Harness
                formRef={(form) => {
                    captured = form;
                }}
            />
        );
        act(() => {
            captured!.setFields([
                { name: "password", errors: ["Password too short"] }
            ]);
        });

        expect(focusSpy).not.toHaveBeenCalled();
        focusSpy.mockRestore();
    });

    it("re-focuses the summary when it transitions from hidden to visible again", () => {
        // After dismissal, a fresh failure must still land focus on the
        // summary — the ref-tracked previous-visibility flag flips back
        // to false on the hidden render so the next 0 -> 1 transition
        // re-focuses.
        const { rerender } = render(<Harness />);
        expect(screen.queryByRole("group")).not.toBeInTheDocument();

        rerender(<Harness serverError={new Error("Boom")} />);
        expect(document.activeElement).toBe(screen.getByRole("group"));

        rerender(<Harness />);
        rerender(<Harness serverError={new Error("Boom again")} />);
        expect(document.activeElement).toBe(screen.getByRole("group"));
    });

    it("lists field-level errors as anchor links when includeFieldErrors is true", () => {
        let captured: FormInstance | null = null;
        render(
            <Harness
                formRef={(form) => {
                    captured = form;
                }}
            />
        );
        act(() => {
            captured!.setFields([
                { name: "email", errors: ["Email is required"] },
                { name: "password", errors: ["Password too short"] }
            ]);
        });

        const links = screen.getAllByRole("link");
        expect(links).toHaveLength(2);
        expect(links[0]).toHaveAttribute("href", "#auth-email");
        expect(links[0]).toHaveTextContent(/email: email is required/i);
        expect(links[1]).toHaveAttribute("href", "#auth-password");
    });

    it("focuses the targeted field when a summary link is clicked", async () => {
        const user = userEvent.setup();
        let captured: FormInstance | null = null;
        render(
            <Harness
                formRef={(form) => {
                    captured = form;
                }}
            />
        );
        act(() => {
            captured!.setFields([
                { name: "email", errors: ["Email is required"] }
            ]);
        });

        await user.click(screen.getByRole("link"));
        expect(document.activeElement).toBe(
            document.getElementById("auth-email")
        );
    });

    it("hides per-field errors when includeFieldErrors is false", () => {
        let captured: FormInstance | null = null;
        render(
            <Harness
                includeFieldErrors={false}
                serverError={new Error("Boom")}
                formRef={(form) => {
                    captured = form;
                }}
            />
        );
        act(() => {
            captured!.setFields([
                { name: "email", errors: ["Email is required"] }
            ]);
        });

        // Only the server message is listed; the field-level link is hidden.
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.getByRole("group")).toHaveTextContent(/boom/i);
    });

    // The 1×1 clipped SrOnly announcer inside the summary sits absolute over
    // the visible submit button on auth pages. Without `pointer-events: none`
    // the invisible box would intercept clicks targeted at the button below.
    // Mirrors the invariant the deleted srOnlyLiveRegions strict file held.
    it("the SR-only announcer inside the summary is non-interactive", () => {
        render(<Harness serverError={new Error("Boom")} />);
        const summary = screen.getByRole("group");
        const srOnly = summary.querySelector("#auth-error-summary-sr-only");
        expect(srOnly).not.toBeNull();
        expect(srOnly).toHaveStyle({ pointerEvents: "none" });
    });
});
