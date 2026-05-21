/* eslint-disable global-require */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../constants/microcopy";

import MainLayout from "./mainLayout";

jest.mock("../components/header", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("header", null, "App Header")
    };
});
jest.mock("../components/projectModal", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("div", null, "Project Modal")
    };
});

describe("MainLayout", () => {
    it("renders the header, main outlet, and project modal", () => {
        const { container } = render(
            <MemoryRouter initialEntries={["/projects"]}>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route
                            path="/projects"
                            element={<div>Project workspace</div>}
                        />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText("App Header")).toBeInTheDocument();
        expect(screen.getByText("Project workspace")).toBeInTheDocument();
        expect(screen.getByText("Project Modal")).toBeInTheDocument();
        expect(container.firstElementChild).toHaveStyle({
            display: "grid"
        });
        expect(container.firstElementChild?.tagName.toLowerCase()).toBe("div");
        expect(container.querySelector("main")).toHaveStyle({
            display: "flex"
        });
    });

    // The skip link is hidden until the user tabs to it (WCAG 2.4.1 Bypass
    // Blocks). It MUST keep `pointer-events: none` until focus, otherwise its
    // 1×1 hit target sits above the stacked chrome and steals clicks that
    // belong to header buttons. Pairs the styled-anchor invariant with the
    // first-tab-focus contract that the deleted strict file used to assert.
    it("renders a skip link that is non-interactive until tab focuses it", async () => {
        render(
            <MemoryRouter>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route index element={<div>page</div>} />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        const skip = screen.getByRole("link", {
            name: microcopy.a11y.skipToMainContent
        });
        expect(skip).toHaveAttribute("href", "#main-content");
        expect(skip).toHaveStyle({ pointerEvents: "none" });
        expect(skip).not.toHaveFocus();

        await userEvent.tab();
        expect(skip).toHaveFocus();
    });
});
