/* eslint-disable global-require */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import useAuth from "../utils/hooks/useAuth";

import LoginPage from "./login";

jest.mock("../components/loginForm", () => {
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
                        onClick: () => props.onError(new Error("Login failed")),
                        type: "button"
                    },
                    "Mock Login Form"
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

const renderLoginPage = ({
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

    window.history.pushState({}, "Login", "/login");

    return render(
        <BrowserRouter>
            <LoginPage />
        </BrowserRouter>
    );
};

describe("LoginPage", () => {
    const originalTitle = document.title;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        document.title = originalTitle;
    });

    // QW-20: every routable surface should advertise the brand in the
    // browser tab via the `useTitle` hook. The login page passes
    // `microcopy.pageTitle.login`; the hook composes "Log in · Pulse".
    it("sets the document title with the ' · Pulse' brand suffix", () => {
        renderLoginPage();

        expect(document.title).toBe("Log in · Pulse");
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
            screen.getByRole("link", { name: /sign up for an account/i })
        ).toBeInTheDocument();
    });

    it("navigates to register from the switch link", () => {
        renderLoginPage();

        fireEvent.click(
            screen.getByRole("link", { name: /sign up for an account/i })
        );

        expect(window.location.pathname).toBe("/register");
    });

    it("redirects an already authenticated user to projects", async () => {
        renderLoginPage({
            isAuthenticated: true,
            currentUser: user()
        });

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });
    });
});
