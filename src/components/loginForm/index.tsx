import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Form, Input, message } from "antd";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { AuthButton } from "../../layouts/authLayout";
import { lineHeight } from "../../theme/tokens";
import useReactMutation from "../../utils/hooks/useReactMutation";
import { writeAiProxyToken, writeAuthToken } from "../../utils/tokenStorage";

import AuthErrorSummary from "../authErrorSummary";
import { AuthTermsAgreement } from "../registerForm/termsAgreement";

const inputSize = "large" as const;

/**
 * Reserves a single line of vertical space for the Caps Lock warning so
 * the Submit button doesn't jump when the warning toggles. The earlier
 * inline `style={{ minHeight: '1.25em', display: 'inline-block' }}` did
 * the same job but spread the magic number across login and register.
 */
const CapsLockSlot = styled.span`
    display: inline-block;
    line-height: ${lineHeight.snug};
    min-height: ${lineHeight.snug}em;
`;

const ForgotPasswordRow = styled.div`
    margin-block-end: 16px;
    text-align: right;
`;

const ForgotPasswordLink = styled(Link)`
    font-size: 0.875rem;
`;

const LoginForm: React.FC<{
    onError: React.Dispatch<React.SetStateAction<Error | IError | null>>;
    serverError?: Error | IError | null;
}> = ({ onError, serverError = null }) => {
    const navigate = useNavigate();
    const [form] = Form.useForm<{ email: string; password: string }>();
    const [capsLockOn, setCapsLockOn] = useState(false);
    const [submitAttempted, setSubmitAttempted] = useState(false);
    const { mutateAsync, isLoading } = useReactMutation<IUser>(
        "auth/login",
        "POST",
        "users",
        undefined,
        onError,
        true
    );
    const handleSubmit = async (input: { email: string; password: string }) => {
        setSubmitAttempted(false);
        try {
            const res = await mutateAsync(input);
            // The auth route is contractually required to return a jwt on
            // a successful login (the server only returns 200 alongside a
            // token), but the IUser type marks it optional because the
            // same shape is reused for /users responses where jwt is
            // absent. Treat a missing token here as an auth handshake bug
            // and surface it instead of writing `"undefined"` to storage.
            if (!res.jwt) {
                throw new Error(microcopy.feedback.loginFailedNoToken);
            }
            // Safari / private mode can refuse `localStorage`; do not navigate
            // without a persisted REST bearer or the app will look "logged out".
            if (!writeAuthToken(res.jwt)) {
                message.error(microcopy.feedback.loginCouldNotPersistSession);
                return;
            }
            if (typeof res.ai_jwt === "string" && res.ai_jwt.length > 0) {
                writeAiProxyToken(res.ai_jwt);
            }
            message.success(microcopy.feedback.welcomeBack);
            navigate("/projects", { viewTransition: true });
        } catch {
            // Error state is set by useReactMutation's onError callback.
        }
    };

    const fieldMeta = [
        { name: "email", id: "email", label: microcopy.fields.email },
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
            >
                {/*
                 * `username` (not `email`) pairs with `current-password` for
                 * iOS Safari / Keychain autofill (WCAG 3.3.7).
                 */}
                <Input
                    autoComplete="username"
                    enterKeyHint="next"
                    inputMode="email"
                    onChange={() => onError(null)}
                    placeholder={microcopy.placeholders.emailExample}
                    size={inputSize}
                    type="email"
                    id="email"
                />
            </Form.Item>
            <Form.Item
                extra={
                    <CapsLockSlot
                        aria-atomic="true"
                        aria-live="polite"
                        role="status"
                    >
                        {capsLockOn ? microcopy.a11y.capsLockOn : ""}
                    </CapsLockSlot>
                }
                label={microcopy.fields.password}
                name="password"
                rules={[
                    {
                        required: true,
                        message: microcopy.validation.passwordRequired
                    }
                ]}
            >
                <Input.Password
                    autoComplete="current-password"
                    enterKeyHint="go"
                    inputMode="text"
                    iconRender={(visible) =>
                        visible ? (
                            <EyeOutlined
                                aria-label={microcopy.actions.hidePassword}
                            />
                        ) : (
                            <EyeInvisibleOutlined
                                aria-label={microcopy.actions.showPassword}
                            />
                        )
                    }
                    onChange={() => onError(null)}
                    onKeyUp={(event) =>
                        setCapsLockOn(
                            "getModifierState" in event &&
                                event.getModifierState("CapsLock")
                        )
                    }
                    size={inputSize}
                    id="password"
                />
            </Form.Item>
            <ForgotPasswordRow>
                <ForgotPasswordLink to="/auth/forgot-password">
                    {microcopy.auth.forgotPassword}
                </ForgotPasswordLink>
            </ForgotPasswordRow>
            <AuthTermsAgreement variant="login" />
            <Form.Item>
                <AuthButton
                    loading={isLoading}
                    htmlType="submit"
                    type="primary"
                >
                    {isLoading
                        ? microcopy.actions.loggingIn
                        : microcopy.actions.logIn}
                </AuthButton>
            </Form.Item>
        </Form>
    );
};

export default LoginForm;
