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
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("surfaces a server error message in the summary", () => {
        render(<Harness serverError={new Error("Invalid credentials")} />);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(/invalid credentials/i);
    });

    it("focuses the summary when it becomes visible", () => {
        render(<Harness serverError={new Error("Server down")} />);
        const alert = screen.getByRole("alert");
        expect(document.activeElement).toBe(alert);
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
        expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
    });
});
