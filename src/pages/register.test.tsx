/* eslint-disable global-require */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import useAuth from "../utils/hooks/useAuth";

import RegisterPage from "./register";

jest.mock("../components/registerForm", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: (props: {
            onError: (error: Error) => void;
            serverError?: Error | null;
        }) =>
            React.createElement(
                React.Fragment,
                null,
                props.serverError
                    ? React.createElement(
                          "div",
                          { role: "alert", tabIndex: -1 },
                          props.serverError.message
                      )
                    : null,
                React.createElement(
                    "button",
                    {
                        onClick: () =>
                            props.onError(new Error("Register failed")),
                        type: "button"
                    },
                    "Mock Register Form"
                )
            )
    };
});
jest.mock("../utils/hooks/useAuth");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

const renderRegisterPage = ({
    currentUser,
    isAuthenticated = false
}: {
    currentUser?: IUser;
    isAuthenticated?: boolean;
} = {}) => {
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated,
        user: currentUser
    });

    window.history.pushState({}, "Register", "/register");

    return render(
        <BrowserRouter>
            <RegisterPage />
        </BrowserRouter>
    );
};

describe("RegisterPage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders title, form, error box, and the login link", () => {
        renderRegisterPage();

        expect(
            screen.getByRole("heading", { name: /sign up for an account/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /mock register form/i })
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: /mock register form/i })
        );

        expect(screen.getByText("Register failed")).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: /log in to your account/i })
        ).toBeInTheDocument();
    });

    it("navigates to login from the switch link", () => {
        renderRegisterPage();

        fireEvent.click(
            screen.getByRole("link", { name: /log in to your account/i })
        );

        expect(window.location.pathname).toBe("/login");
    });

    it("redirects an already authenticated user to projects", async () => {
        renderRegisterPage({
            currentUser: user(),
            isAuthenticated: true
        });

        await waitFor(() => expect(window.location.pathname).toBe("/projects"));
    });
});
