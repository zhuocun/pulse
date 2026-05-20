/* eslint-disable global-require */
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import useAuth from "../utils/hooks/useAuth";

import HomePage from "./home";

jest.mock("../layouts/authLayout", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () =>
            React.createElement("div", { "data-testid": "auth-layout" }, "Auth")
    };
});
jest.mock("../layouts/mainLayout", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () =>
            React.createElement("div", { "data-testid": "main-layout" }, "Main")
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

const renderHome = ({
    path,
    isAuthenticated,
    currentUser
}: {
    path: string;
    isAuthenticated: boolean;
    currentUser?: IUser;
}) => {
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated,
        user: currentUser
    });

    window.history.pushState({}, "Home", path);

    render(
        <BrowserRouter>
            <HomePage />
        </BrowserRouter>
    );
};

describe("HomePage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("redirects authenticated users away from auth routes", () => {
        renderHome({
            currentUser: user(),
            path: "/login",
            isAuthenticated: true
        });

        expect(window.location.pathname).toBe("/projects");
        expect(screen.getByTestId("main-layout")).toBeInTheDocument();
    });

    it("redirects anonymous users from protected routes to login", () => {
        renderHome({
            path: "/projects",
            isAuthenticated: false
        });

        expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
        expect(window.location.pathname).toBe("/login");
    });

    it("renders the main layout for authenticated protected routes", () => {
        renderHome({
            currentUser: user(),
            path: "/projects",
            isAuthenticated: true
        });

        expect(screen.getByTestId("main-layout")).toBeInTheDocument();
    });

    it("renders the main layout when a token exists but the user profile is still hydrating", () => {
        renderHome({
            path: "/projects",
            isAuthenticated: true
        });

        expect(screen.getByTestId("main-layout")).toBeInTheDocument();
    });

    it("renders the auth layout for anonymous auth routes", () => {
        renderHome({
            path: "/register",
            isAuthenticated: false
        });

        expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
    });

    it("treats /auth/forgot-password as an auth route", () => {
        renderHome({
            path: "/auth/forgot-password",
            isAuthenticated: false
        });

        expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
        expect(window.location.pathname).toBe("/auth/forgot-password");
    });
});
