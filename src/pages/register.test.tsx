/* eslint-disable global-require */
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

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

const renderRegisterPage = () => {
    window.history.pushState({}, "Register", "/register");

    return render(
        <BrowserRouter>
            <RegisterPage />
        </BrowserRouter>
    );
};

describe("RegisterPage", () => {
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
});
