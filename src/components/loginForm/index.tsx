import { QueryClientContext } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useContext, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Form } from "@/components/ui/form";
import { Input, type InputProps } from "@/components/ui/input";
import useAppMessage from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { AuthButton } from "../../layouts/authLayout";
import useApi from "../../utils/hooks/useApi";
import useReactMutation from "../../utils/hooks/useReactMutation";
import { writeAiProxyToken } from "../../utils/tokenStorage";

import AuthErrorSummary from "../authErrorSummary";
import { AuthTermsAgreement } from "../registerForm/termsAgreement";

const userQueryKey = ["users"] as const;

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

/**
 * Router location state shape forwarded by `RequireAuth` when it
 * redirects an unauthenticated visit to `/login`. The `from` field is
 * the original path + search the user was trying to reach (e.g.
 * `/share?title=foo` from an external share sheet) so login can return
 * them there after authenticating.
 */
interface LoginLocationState {
    from?: string;
}

const isLoginLocationState = (value: unknown): value is LoginLocationState =>
    value !== null && typeof value === "object" && !Array.isArray(value);

// Reject protocol-relative (`//evil.com`) and absolute (`https://…`) URLs so a
// stale or attacker-controlled `state.from` cannot open-redirect off-origin.
const isInternalPath = (raw: unknown): raw is string =>
    typeof raw === "string" && /^\/(?!\/)/.test(raw);

const LoginForm: React.FC<{
    onError: React.Dispatch<React.SetStateAction<Error | IError | null>>;
    serverError?: Error | IError | null;
}> = ({ onError, serverError = null }) => {
    const message = useAppMessage();
    const navigate = useNavigate();
    const location = useLocation();
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
            /*
             * Honor the `from` hint forwarded by `RequireAuth` so a
             * user who landed on /login via a protected redirect lands
             * back where they came from (typically `/share?title=…`).
             * Defaults to `/projects` so the normal direct-login flow
             * still goes to the project list. Any non-object state, or
             * a `from` that isn't a single-leading-slash internal path,
             * falls through to the default — guards against open
             * redirect via stale / synthesized router state.
             */
            const state = isLoginLocationState(location.state)
                ? location.state
                : undefined;
            const target = isInternalPath(state?.from)
                ? state.from
                : "/projects";
            navigate(target, { viewTransition: true });
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
                    autoComplete="username webauthn"
                    enterKeyHint="next"
                    id="email"
                    inputMode="email"
                    placeholder={microcopy.placeholders.emailExample}
                    type="email"
                />
            </Form.Item>
            <Form.Item
                extra={
                    <span
                        aria-atomic="true"
                        aria-live="polite"
                        className="inline-block min-h-[1.4em] leading-snug"
                        role="status"
                    >
                        {capsLockOn ? microcopy.a11y.capsLockOn : ""}
                    </span>
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
                <PasswordInput
                    autoComplete="current-password"
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
            <div className="mb-md text-right">
                <Link
                    className="text-sm text-primary underline-offset-4 hover:underline coarse:inline-flex coarse:min-h-[44px] coarse:items-center"
                    to="/auth/forgot-password"
                >
                    {microcopy.auth.forgotPassword}
                </Link>
            </div>
            <AuthTermsAgreement variant="login" />
            <Form.Item>
                <AuthButton
                    htmlType="submit"
                    loading={isLoading || isVerifyingSession}
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
