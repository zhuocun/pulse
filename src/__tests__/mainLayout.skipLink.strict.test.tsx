import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import MainLayout from "../layouts/mainLayout";

jest.mock("../components/header", () => ({
    __esModule: true,
    default: () => <header>stub-header</header>
}));
jest.mock("../components/projectModal", () => ({
    __esModule: true,
    default: () => null
}));

describe("MainLayout skip link hit targeting", () => {
    it("disables pointer-events until focused so stacked chrome stays clickable", async () => {
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
        expect(skip).not.toHaveFocus();
        expect(skip).toHaveStyle({ pointerEvents: "none" });

        const user = userEvent.setup();
        await user.tab();

        expect(skip).toHaveFocus();
    });
});
