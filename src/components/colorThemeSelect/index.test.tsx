import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
    userPreferencesSlice,
    type ColorThemePreference
} from "../../store/reducers/userPreferencesSlice";

import ColorThemeSelect from ".";

expect.extend(toHaveNoViolations);

const makeStore = (colorTheme: ColorThemePreference = "orange") =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto" as const,
                glassIntensityVersion: 1,
                colorTheme
            }
        }
    });

const renderSelect = (colorTheme: ColorThemePreference = "orange") => {
    const store = makeStore(colorTheme);
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    const view = render(<ColorThemeSelect />, { wrapper: Wrapper });
    return { ...view, store };
};

describe("ColorThemeSelect", () => {
    it("labels the segmented control as a color-theme group", () => {
        renderSelect();
        expect(
            screen.getByRole("group", { name: /change color theme/i })
        ).toBeInTheDocument();
    });

    it("renders all three palette options in registry order", () => {
        renderSelect();
        // AntD Segmented renders each option as a radio in the
        // accessible tree.
        for (const name of ["Orange", "Blue", "Emerald"]) {
            expect(screen.getByRole("radio", { name })).toBeInTheDocument();
        }
    });

    it("reflects the current preference (orange default)", () => {
        renderSelect("orange");
        expect(screen.getByRole("radio", { name: "Orange" })).toBeChecked();
    });

    it("reflects an explicit emerald preference", () => {
        renderSelect("emerald");
        expect(screen.getByRole("radio", { name: "Emerald" })).toBeChecked();
    });

    it("dispatches setColorTheme when a different palette is picked", () => {
        const { store } = renderSelect("orange");
        // The Segmented input has pointer-events: none, so fireEvent is
        // required to bypass it (mirrors the GlassIntensitySelect test).
        fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
        expect(store.getState().userPreferences.colorTheme).toBe("blue");
    });

    it("dispatches setColorTheme back to orange (the default)", () => {
        const { store } = renderSelect("emerald");
        fireEvent.click(screen.getByRole("radio", { name: "Orange" }));
        expect(store.getState().userPreferences.colorTheme).toBe("orange");
    });

    it("renders without axe-detectable accessibility violations", async () => {
        const { container } = renderSelect();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
