import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Form } from "@/components/ui/form";
import { Input, type InputProps } from "@/components/ui/input";
import useAppMessage from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { AuthButton } from "../../layouts/authLayout";
import useReactMutation from "../../utils/hooks/useReactMutation";

import AuthErrorSummary from "../authErrorSummary";
import { PasswordStrengthHint } from "./passwordStrengthHint";
import { AuthTermsAgreement } from "./termsAgreement";

/**
 * Password field with an eye/eye-off adornment — replaces antd's
 * `Input.Password`. `Form.Item` clones this control and injects
 * `value` / `onChange` / `onBlur` / `id` / `aria-*`, which spread onto the
 * inner `<input>`; the toggle is a sibling button so the primitive stays a
 * plain themed input.
 */
const PasswordInput = forwardRef<HTMLInputElement, InputProps>(
    ({ className, ...props }, ref) => {
        const [visible, setVisible] = useState(false);
        return (
            <div className="relative">
                <Input
                    ref={ref}
                    className={cn("pr-11", className)}
                    type={visible ? "text" : "password"}
                    {...props}
                />
                <button
                    aria-label={
                        visible
                            ? microcopy.actions.hidePassword
                            : microcopy.actions.showPassword
                    }
                    className="absolute inset-y-0 right-0 flex items-center justify-center rounded-md px-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-[44px] coarse:min-w-[44px]"
                    onClick={() => setVisible((prev) => !prev)}
                    type="button"
                >
                    {visible ? (
                        <Eye aria-hidden className="size-4" />
                    ) : (
                        <EyeOff aria-hidden className="size-4" />
                    )}
                </button>
            </div>
        );
    }
);
PasswordInput.displayName = "PasswordInput";

const RegisterForm: React.FC<{
    onError: React.Dispatch<React.SetStateAction<Error | null | IError>>;
    serverError?: Error | IError | null;
}> = ({ onError, serverError = null }) => {
    const message = useAppMessage();
    const navigate = useNavigate();
    const location = useLocation();
    const [form] = Form.useForm<{
        email: string;
        username: string;
        password: string;
    }>();
    const passwordValue = (Form.useWatch("password", form) as string) ?? "";
    const [capsLockOn, setCapsLockOn] = useState(false);
    const [submitAttempted, setSubmitAttempted] = useState(false);
    const { mutateAsync, isLoading } = useReactMutation(
        "auth/register",
        "POST",
        undefined,
        undefined,
        onError,
        false
    );
    const handleSubmit = async (input: {
        username: string;
        email: string;
        password: string;
    }) => {
        setSubmitAttempted(false);
        try {
            await mutateAsync({
                ...input,
                email: input.email.trim().toLowerCase(),
                username: input.username.trim()
            });
            // Confirm success before navigating so the user knows the
            // request was received — without this the redirect can read
            // as a navigation glitch on a slow connection.
            message.success(microcopy.feedback.accountCreated);
            // Forward the original location state (e.g. the `from`
            // hint set by `RequireAuth`) so a share → /login → "Sign
            // up" → register → /login round-trip preserves the
            // post-login redirect target.
            navigate("/login", {
                viewTransition: true,
                state: location.state
            });
        } catch {
            // Error state is set by useReactMutation's onError callback.
        }
    };
    const fieldMeta = [
        { name: "email", id: "email", label: microcopy.fields.email },
        {
            name: "username",
            id: "username",
            label: microcopy.fields.username
        },
        {
            name: "password",
            id: "password",
            label: microcopy.fields.password
        }
    ] as const;

    return (
        <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            onFinishFailed={() => setSubmitAttempted(true)}
        >
            <AuthErrorSummary
                fields={fieldMeta}
                includeFieldErrors={submitAttempted}
                serverError={serverError}
            />
            <Form.Item
                label={microcopy.fields.email}
                name="email"
                rules={[
                    {
                        required: true,
                        message: microcopy.validation.emailRequired
                    },
                    {
                        type: "email",
                        message: microcopy.validation.emailInvalid
                    }
                ]}
                validateTrigger={["onBlur", "onSubmit"]}
            >
                <Input
                    autoComplete="email"
                    enterKeyHint="next"
                    id="email"
                    inputMode="email"
                    placeholder={microcopy.placeholders.emailExample}
                    type="email"
                />
            </Form.Item>
            <Form.Item
                label={microcopy.fields.username}
                name="username"
                rules={[
                    {
                        required: true,
                        whitespace: true,
                        message: microcopy.validation.usernameRequired
                    }
                ]}
                validateTrigger={["onBlur", "onSubmit"]}
            >
                <Input
                    autoComplete="username"
                    enterKeyHint="next"
                    id="username"
                    inputMode="text"
                    type="text"
                />
            </Form.Item>
            <Form.Item
                extra={
                    <>
                        <PasswordStrengthHint password={passwordValue} />
                        <span
                            aria-atomic="true"
                            aria-live="polite"
                            className="inline-block min-h-[1.4em] leading-snug"
                            role="status"
                        >
                            {capsLockOn ? microcopy.a11y.capsLockOn : ""}
                        </span>
                    </>
                }
                label={microcopy.fields.password}
                name="password"
                rules={[
                    {
                        required: true,
                        message: microcopy.validation.passwordRequired
                    },
                    {
                        min: 8,
                        message: microcopy.validation.passwordTooShort
                    }
                ]}
                validateTrigger={["onBlur", "onSubmit"]}
            >
                <PasswordInput
                    autoComplete="new-password"
                    enterKeyHint="go"
                    id="password"
                    inputMode="text"
                    onKeyUp={(event) =>
                        setCapsLockOn(
                            "getModifierState" in event &&
                                event.getModifierState("CapsLock")
                        )
                    }
                />
            </Form.Item>
            <AuthTermsAgreement variant="register" />
            <Form.Item>
                <AuthButton
                    htmlType="submit"
                    loading={isLoading}
                    type="primary"
                >
                    {isLoading
                        ? microcopy.actions.signingUp
                        : microcopy.actions.signUp}
                </AuthButton>
            </Form.Item>
        </Form>
    );
};

export default RegisterForm;
