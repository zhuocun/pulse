import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message } from "antd";
import { BrowserRouter } from "react-router-dom";

import useReactMutation from "../../utils/hooks/useReactMutation";
import { readAuthToken } from "../../utils/tokenStorage";

import LoginForm from ".";

jest.mock("../../utils/hooks/useReactMutation");

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;

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
    jwt: "jwt-1",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

const renderLoginForm = ({
    isLoading = false,
    onError = jest.fn()
}: {
    isLoading?: boolean;
    onError?: jest.Mock;
} = {}) => {
    mockedUseReactMutation.mockReturnValue({
        isLoading,
        mutateAsync
    } as unknown as ReturnType<typeof useReactMutation<IUser>>);

    window.history.pushState({}, "Login", "/login");

    render(
        <BrowserRouter>
            <LoginForm onError={onError} />
        </BrowserRouter>
    );

    return { onError };
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
        localStorage.clear();
        jest.clearAllMocks();
        mutateAsync.mockResolvedValue(user());
    });

    it("wires the login mutation with cache and error handling", () => {
        const onError = jest.fn();

        renderLoginForm({ onError });

        expect(mockedUseReactMutation).toHaveBeenCalledWith(
            "auth/login",
            "POST",
            "users",
            undefined,
            onError,
            true
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

    it("submits credentials, stores the jwt, and navigates to projects", async () => {
        mutateAsync.mockResolvedValue(user({ jwt: "jwt-login" }));
        renderLoginForm();

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
            expect(window.location.pathname).toBe("/projects");
        });
        expect(readAuthToken()).toBe("jwt-login");
    });

    it("shows a welcome-back toast on successful login", async () => {
        mutateAsync.mockResolvedValue(user({ jwt: "jwt-login" }));
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
        expect(readAuthToken()).toBeNull();
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
});
