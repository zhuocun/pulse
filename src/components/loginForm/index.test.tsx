import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { message } from "antd";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import useApi from "../../utils/hooks/useApi";
import useReactMutation from "../../utils/hooks/useReactMutation";
import * as tokenStorage from "../../utils/tokenStorage";

import LoginForm from ".";

jest.mock("../../utils/hooks/useApi");
jest.mock("../../utils/hooks/useReactMutation");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;

const api = jest.fn();
const mutateAsync = jest.fn();

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ai_jwt: "ai-1",
    ...overrides
});

const renderLoginForm = ({
    isLoading = false,
    onError = jest.fn()
}: {
    isLoading?: boolean;
    onError?: jest.Mock;
} = {}) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    mockedUseApi.mockReturnValue(api as unknown as ReturnType<typeof useApi>);
    mockedUseReactMutation.mockReturnValue({
        isLoading,
        mutateAsync
    } as unknown as ReturnType<typeof useReactMutation<IUser>>);

    window.history.pushState({}, "Login", "/login");

    render(
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <LoginForm onError={onError} />
            </BrowserRouter>
        </QueryClientProvider>
    );

    return { onError, queryClient };
};

const changeField = async (label: RegExp, value: string) => {
    await act(async () => {
        fireEvent.change(screen.getByLabelText(label), {
            target: { value }
        });
    });
};

const submitLogin = async () => {
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    });
};

describe("LoginForm", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        sessionStorage.clear();
        jest.clearAllMocks();
        mutateAsync.mockResolvedValue(user());
        api.mockResolvedValue(user());
    });

    it("wires the login mutation with cache and error handling", () => {
        const onError = jest.fn();

        renderLoginForm({ onError });

        expect(mockedUseReactMutation).toHaveBeenCalledWith(
            "auth/login",
            "POST",
            "users",
            undefined,
            onError
        );
    });

    it("validates required credentials", async () => {
        renderLoginForm();

        await submitLogin();

        expect(
            await screen.findByText("Please enter your email")
        ).toBeInTheDocument();
        expect(
            await screen.findByText("Please enter your password")
        ).toBeInTheDocument();
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it("after an empty submit, shows an error summary with links to each invalid field", async () => {
        const rtlUser = userEvent.setup();
        renderLoginForm();

        await submitLogin();

        const summary = await screen.findByRole("alert", {
            name: /there is a problem/i
        });
        expect(summary).toBeInTheDocument();
        expect(
            screen.getByRole("heading", {
                name: /there is a problem/i
            })
        ).toBeInTheDocument();

        const emailLink = summary.querySelector('a[href="#email"]');
        const passwordLink = summary.querySelector('a[href="#password"]');
        expect(emailLink).toBeTruthy();
        expect(passwordLink).toBeTruthy();

        expect(emailLink).toHaveTextContent(/please enter your email/i);
        expect(passwordLink).toHaveTextContent(/please enter your password/i);

        await rtlUser.click(emailLink!);
        expect(screen.getByLabelText(/^email$/i)).toHaveFocus();
    });

    it("does not block paste on the password field", async () => {
        const rtlUser = userEvent.setup();
        renderLoginForm();

        const password = screen.getByLabelText(/^password$/i);
        await rtlUser.click(password);
        await rtlUser.paste("pasted-secret");

        expect(password).toHaveValue("pasted-secret");
    });

    it("validates email format", async () => {
        renderLoginForm();

        await changeField(/^email$/i, "not-an-email");
        await changeField(/^password$/i, "secret");
        await submitLogin();

        expect(
            await screen.findByText("Please enter a valid email address")
        ).toBeInTheDocument();
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it("clears the parent error as fields change", async () => {
        const { onError } = renderLoginForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^password$/i, "secret");

        expect(onError).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenCalledWith(null);
    });

    it("submits credentials, verifies the session, stores the AI proxy token, and SPA-navigates to projects", async () => {
        // The REST JWT itself rides an HttpOnly cookie the backend set
        // on the login response -- ``credentials: "include"`` on every
        // subsequent same-origin fetch picks it up automatically, and
        // JS never sees it. We force a fresh ``GET /users`` before
        // navigating so a response body without a persisted cookie
        // cannot strand the user on /projects with 401ing API calls.
        mutateAsync.mockResolvedValue(user({ ai_jwt: "ai-token" }));
        const { queryClient } = renderLoginForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^password$/i, "secret");
        await submitLogin();

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith({
                email: "alice@example.com",
                password: "secret"
            });
        });
        await waitFor(() => {
            expect(api).toHaveBeenCalledWith("users", {
                dedup: false,
                rateLimit: false
            });
        });
        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });
        expect(queryClient.getQueryData(["users"])).toEqual(user());
        expect(tokenStorage.readAiProxyToken()).toBe("ai-token");
    });

    it("does not crash when the login response omits the AI proxy token", async () => {
        // Login may legitimately come back without ``ai_jwt`` (AI
        // disabled, restricted account). The route guard's source of
        // truth is the cached user, not this optional field.
        mutateAsync.mockResolvedValue(user({ ai_jwt: undefined }));
        renderLoginForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^password$/i, "secret");
        await submitLogin();

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });
        expect(tokenStorage.readAiProxyToken()).toBeNull();
    });

    it("sets autoComplete=username on the email field for password managers", () => {
        renderLoginForm();
        const email = screen.getByLabelText(/^email$/i);
        expect(email).toHaveAttribute("autocomplete", "username");
    });

    it("shows a welcome-back toast on successful login", async () => {
        mutateAsync.mockResolvedValue(user());
        const successSpy = jest
            .spyOn(message, "success")
            .mockImplementation(() => "" as never);
        renderLoginForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^password$/i, "secret");
        await submitLogin();

        await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
        expect(successSpy.mock.calls[0][0]).toMatch(/welcome back/i);

        successSpy.mockRestore();
    });

    it("keeps login failures on the current page for inline error handling", async () => {
        mutateAsync.mockRejectedValue(new Error("Invalid credentials"));
        renderLoginForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^password$/i, "wrong");
        await submitLogin();

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith({
                email: "alice@example.com",
                password: "wrong"
            });
        });
        expect(window.location.pathname).toBe("/login");
        expect(tokenStorage.readAiProxyToken()).toBeNull();
    });

    it("stays on login and surfaces an error when the session cookie cannot be verified", async () => {
        api.mockRejectedValue(new Error("empty JWT"));
        const { onError, queryClient } = renderLoginForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^password$/i, "secret");
        await submitLogin();

        await waitFor(() => {
            expect(api).toHaveBeenCalledWith("users", {
                dedup: false,
                rateLimit: false
            });
        });
        expect(window.location.pathname).toBe("/login");
        expect(queryClient.getQueryData(["users"])).toBeUndefined();
        expect(tokenStorage.readAiProxyToken()).toBeNull();
        expect(onError).toHaveBeenCalledWith(
            new Error(microcopy.feedback.loginCouldNotPersistSession)
        );
    });

    it("shows the submitting state from the mutation", () => {
        renderLoginForm({ isLoading: true });

        expect(
            screen.getByRole("button", { name: /log(ging)? in/i })
        ).toHaveClass("ant-btn-loading");
    });

    it("renders a forgot-password link that is keyboard-focusable", async () => {
        renderLoginForm();
        const keyboard = userEvent.setup();
        const link = screen.getByRole("link", { name: /forgot password\?/i });

        expect(link).toHaveAttribute("href", "/auth/forgot-password");

        for (let i = 0; i < 6; i += 1) {
            await keyboard.tab();
            if (document.activeElement === link) break;
        }

        expect(link).toHaveFocus();
    });

    it("renders a Terms of Service link in the auth agreement line", () => {
        renderLoginForm();
        expect(
            screen.getByRole("link", { name: /^terms of service$/i })
        ).toHaveAttribute("href", "/auth/terms");
    });
});
