import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { QueryClientContext } from "@tanstack/react-query";
import { Form, Input, message } from "antd";
import { useContext, useState } from "react";
import { Link, useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { AuthButton } from "../../layouts/authLayout";
import { lineHeight } from "../../theme/tokens";
import useApi from "../../utils/hooks/useApi";
import useReactMutation from "../../utils/hooks/useReactMutation";
import { writeAiProxyToken } from "../../utils/tokenStorage";

import AuthErrorSummary from "../authErrorSummary";
import { AuthTermsAgreement } from "../registerForm/termsAgreement";

const inputSize = "large" as const;
const userQueryKey = ["users"] as const;

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
    const api = useApi();
    const queryClient = useContext(QueryClientContext);
    const [form] = Form.useForm<{ email: string; password: string }>();
    const [capsLockOn, setCapsLockOn] = useState(false);
    const [submitAttempted, setSubmitAttempted] = useState(false);
    const [isVerifyingSession, setIsVerifyingSession] = useState(false);
    const { mutateAsync, isLoading } = useReactMutation<IUser>(
        "auth/login",
        "POST",
        "users",
        undefined,
        onError
    );
    const handleSubmit = async (input: { email: string; password: string }) => {
        setSubmitAttempted(false);
        let res: IUser;
        try {
            res = await mutateAsync({
                ...input,
                email: input.email.trim().toLowerCase()
            });
        } catch {
            // Error state is set by useReactMutation's onError callback.
            return;
        }

        setIsVerifyingSession(true);
        try {
            // The login response body is not enough to prove the
            // HttpOnly cookie survived the proxy/browser roundtrip.
            // Force a fresh post-login `/users` probe before routing
            // into pages whose API calls require that cookie.
            const verifiedUser = (await api("users", {
                dedup: false,
                rateLimit: false
            })) as IUser;
            queryClient?.setQueryData(userQueryKey, verifiedUser);
            if (typeof res.ai_jwt === "string" && res.ai_jwt.length > 0) {
                writeAiProxyToken(res.ai_jwt);
            }
            message.success(microcopy.feedback.welcomeBack);
            navigate("/projects", { viewTransition: true });
        } catch {
            queryClient?.setQueryData(userQueryKey, undefined);
            onError(new Error(microcopy.feedback.loginCouldNotPersistSession));
        } finally {
            setIsVerifyingSession(false);
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
                validateTrigger={["onBlur", "onSubmit"]}
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
                validateTrigger={["onBlur", "onSubmit"]}
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
                    loading={isLoading || isVerifyingSession}
                    htmlType="submit"
                    type="primary"
                >
                    {isLoading || isVerifyingSession
                        ? microcopy.actions.loggingIn
                        : microcopy.actions.logIn}
                </AuthButton>
            </Form.Item>
        </Form>
    );
};

export default LoginForm;
