import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
    userPreferencesSlice,
    type GlassIntensityPreference
} from "../../store/reducers/userPreferencesSlice";

import GlassIntensitySelect from ".";

expect.extend(toHaveNoViolations);

const makeStore = (preference: GlassIntensityPreference = "auto") =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: preference,
                // Phase 6 Wave 1 — preloadedState must carry the
                // current migration sentinel.
                glassIntensityVersion: 1
            }
        }
    });

const renderSelect = (preference: GlassIntensityPreference = "auto") => {
    const store = makeStore(preference);
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    const view = render(<GlassIntensitySelect />, { wrapper: Wrapper });
    return { ...view, store };
};

describe("GlassIntensitySelect", () => {
    it("labels the segmented control as a glass-intensity group", () => {
        renderSelect();
        expect(
            screen.getByRole("group", { name: /change glass intensity/i })
        ).toBeInTheDocument();
    });

    it("renders all four options (auto, clear, regular, solid)", () => {
        renderSelect();
        // AntD Segmented renders each option as a radio in the
        // accessible tree.
        expect(screen.getByRole("radio", { name: "Auto" })).toBeInTheDocument();
        expect(
            screen.getByRole("radio", { name: "Clear" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("radio", { name: "Regular" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("radio", { name: "Solid" })
        ).toBeInTheDocument();
    });

    it("reflects the current preference (auto)", () => {
        renderSelect("auto");
        const autoRadio = screen.getByRole("radio", { name: "Auto" });
        expect(autoRadio).toBeChecked();
    });

    it("reflects an explicit clear preference", () => {
        renderSelect("clear");
        expect(screen.getByRole("radio", { name: "Clear" })).toBeChecked();
    });

    it("dispatches setGlassIntensity when a different segment is picked", () => {
        const { store } = renderSelect("auto");
        // The Segmented input has pointer-events: none so fireEvent
        // is required to bypass it (mirrors the LanguageSwitcher
        // test pattern).
        const solidRadio = screen.getByRole("radio", { name: "Solid" });
        fireEvent.click(solidRadio);
        expect(store.getState().userPreferences.glassIntensity).toBe("solid");
    });

    it("dispatches setGlassIntensity for the regular option", () => {
        const { store } = renderSelect("solid");
        fireEvent.click(screen.getByRole("radio", { name: "Regular" }));
        expect(store.getState().userPreferences.glassIntensity).toBe("regular");
    });

    it("labels the group label with the localized 'Glass' string", () => {
        // The visual label sits to the left of the Segmented control
        // and reads "Glass" in English. A regression that drops the
        // label leaves screen-reader users with only the
        // changeGlassIntensity aria-label, which is technically OK
        // but inconsistent with the other rows in the dropdown.
        renderSelect();
        expect(screen.getByText("Glass")).toBeInTheDocument();
    });

    it("renders without axe-detectable accessibility violations", async () => {
        const { container } = renderSelect();
        // Default jest-axe options — exercises the AntD Segmented's
        // accessibility tree shape plus our label association via
        // role=group + aria-label.
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
