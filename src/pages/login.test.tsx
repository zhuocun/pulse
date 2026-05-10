/* eslint-disable global-require */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import useAuth from "../utils/hooks/useAuth";

import LoginPage from "./login";

jest.mock("../components/loginForm", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: (props: { onError: (error: Error) => void }) =>
            React.createElement(
                "button",
                {
                    onClick: () => props.onError(new Error("Login failed")),
                    type: "button"
                },
                "Mock Login Form"
            )
    };
});
jest.mock("../utils/hooks/useAuth");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    jwt: "jwt-1",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

const renderLoginPage = ({
    currentUser,
    token = null
}: {
    currentUser?: IUser;
    token?: string | null;
} = {}) => {
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        refreshUser: jest.fn(),
        token,
        user: currentUser
    });

    window.history.pushState({}, "Login", "/login");

    return render(
        <BrowserRouter>
            <LoginPage />
        </BrowserRouter>
    );
};

describe("LoginPage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders title, form, error box, and the register link", () => {
        renderLoginPage();

        expect(
            screen.getByRole("heading", { name: /log in to your account/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /mock login form/i })
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: /mock login form/i })
        );

        expect(screen.getByText("Login failed")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /sign up for an account/i })
        ).toBeInTheDocument();
    });

    it("navigates to register from the switch link", () => {
        renderLoginPage();

        fireEvent.click(
            screen.getByRole("button", { name: /sign up for an account/i })
        );

        expect(window.location.pathname).toBe("/register");
    });

    it("redirects an already authenticated user to projects", async () => {
        renderLoginPage({
            currentUser: user(),
            token: "jwt-1"
        });

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });
    });
});
