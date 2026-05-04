import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Form, Input, message } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { AuthButton } from "../../layouts/authLayout";
import { lineHeight } from "../../theme/tokens";
import useReactMutation from "../../utils/hooks/useReactMutation";

const inputSize = "large" as const;

const CapsLockSlot = styled.span`
    display: inline-block;
    line-height: ${lineHeight.snug};
    min-height: ${lineHeight.snug}em;
`;

const RegisterForm: React.FC<{
    onError: React.Dispatch<React.SetStateAction<Error | null | IError>>;
}> = ({ onError }) => {
    const navigate = useNavigate();
    const [capsLockOn, setCapsLockOn] = useState(false);
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
        try {
            await mutateAsync({
                ...input,
                email: input.email.trim(),
                username: input.username.trim()
            });
            // Confirm success before navigating so the user knows the
            // request was received — without this the redirect can read
            // as a navigation glitch on a slow connection.
            message.success(microcopy.feedback.accountCreated);
            navigate("/login", { viewTransition: true });
        } catch {
            // Error state is set by useReactMutation's onError callback.
        }
    };
    return (
        <Form layout="vertical" onFinish={handleSubmit}>
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
                <Input
                    autoComplete="email"
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
                label={microcopy.fields.username}
                name="username"
                rules={[
                    {
                        required: true,
                        whitespace: true,
                        message: microcopy.validation.usernameRequired
                    }
                ]}
            >
                <Input
                    autoComplete="username"
                    enterKeyHint="next"
                    inputMode="text"
                    onChange={() => onError(null)}
                    size={inputSize}
                    type="text"
                    id="username"
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
                    },
                    {
                        min: 8,
                        message: microcopy.validation.passwordTooShort
                    }
                ]}
            >
                <Input.Password
                    autoComplete="new-password"
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
            <Form.Item>
                <AuthButton
                    loading={isLoading}
                    htmlType="submit"
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
