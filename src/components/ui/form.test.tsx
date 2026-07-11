import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import * as React from "react";

import { Form, type FormInstance } from "./form";
import { Input } from "./input";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

interface Values extends Record<string, unknown> {
    email: string;
}

const Harness = ({
    onFinish,
    onFinishFailed,
    formRef
}: {
    onFinish?: (values: Values) => void;
    onFinishFailed?: () => void;
    formRef?: (form: FormInstance<Values>) => void;
}) => {
    const [form] = Form.useForm<Values>();
    formRef?.(form);
    const watched = Form.useWatch("email", form);
    return (
        <div>
            <span data-testid="watched">{String(watched ?? "")}</span>
            <Form
                form={form}
                onFinish={onFinish}
                onFinishFailed={onFinishFailed}
            >
                <Form.Item
                    name="email"
                    label="Email"
                    rules={[
                        { required: true, message: "Email is required" },
                        { type: "email", message: "Enter a valid email" }
                    ]}
                >
                    <Input />
                </Form.Item>
                <button type="submit">Save</button>
            </Form>
        </div>
    );
};

const submitForm = (container: HTMLElement) => {
    const form = container.querySelector("form");
    if (form) fireEvent.submit(form);
};

describe("Form", () => {
    it("blocks submit and surfaces the error when a required field is empty", () => {
        const onFinish = jest.fn();
        const onFinishFailed = jest.fn();
        const { container } = render(
            <Harness onFinish={onFinish} onFinishFailed={onFinishFailed} />
        );
        submitForm(container);
        expect(onFinish).not.toHaveBeenCalled();
        expect(onFinishFailed).toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Email is required"
        );
    });

    it("calls onFinish with the collected values when valid", () => {
        const onFinish = jest.fn();
        const { container } = render(<Harness onFinish={onFinish} />);
        fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
            target: { value: "ada@example.com" }
        });
        submitForm(container);
        expect(onFinish).toHaveBeenCalledWith({ email: "ada@example.com" });
    });

    it("reflects setFieldsValue in the control and Form.useWatch", () => {
        let instance: FormInstance<Values> | undefined;
        render(<Harness formRef={(form) => (instance = form)} />);
        act(() => {
            instance?.setFieldsValue({ email: "linus@example.com" });
        });
        expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
            "linus@example.com"
        );
        expect(screen.getByTestId("watched")).toHaveTextContent(
            "linus@example.com"
        );
    });

    it("tracks touched state and resets fields", () => {
        let instance: FormInstance<Values> | undefined;
        render(<Harness formRef={(form) => (instance = form)} />);
        expect(instance?.isFieldsTouched()).toBe(false);
        fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
            target: { value: "x@y.z" }
        });
        expect(instance?.isFieldsTouched()).toBe(true);
        act(() => {
            instance?.resetFields();
        });
        expect(instance?.isFieldsTouched()).toBe(false);
        expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    });

    it("declares a touch-target height on its controls (WCAG 2.5.8)", () => {
        render(<Harness />);
        expect(
            declaresTouchTarget(screen.getByRole("textbox", { name: "Email" }))
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Harness />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
