import { fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider, useLocale } from "../../i18n";

import LanguageSwitcher from "./index";

const LocaleSpy = () => {
    const { locale } = useLocale();
    return <span data-testid="locale-spy">{locale}</span>;
};

const renderSwitcher = () =>
    render(
        <LanguageProvider>
            <LanguageSwitcher />
            <LocaleSpy />
        </LanguageProvider>
    );

describe("LanguageSwitcher", () => {
    it("labels the segmented control as a language group", () => {
        renderSwitcher();
        expect(
            screen.getByRole("group", { name: /change language/i })
        ).toBeInTheDocument();
    });

    it("renders each locale's native name (so users can recognise their script)", () => {
        renderSwitcher();
        expect(screen.getByText("English")).toBeInTheDocument();
        // Chinese (Simplified) renders as its native script — and is the only
        // additional locale ships with the registry.
        expect(screen.getByText("中文")).toBeInTheDocument();
    });

    it("switches the active locale when a different segment is selected", () => {
        renderSwitcher();

        // Pre-switch: default English is active.
        expect(screen.getByTestId("locale-spy")).toHaveTextContent("en");

        // The Segmented input itself has pointer-events: none, so the visual
        // label is the real click target. fireEvent bypasses pointer-events
        // semantics and still triggers AntD's onChange.
        const zhRadio = screen.getByRole("radio", { name: "中文" });
        fireEvent.click(zhRadio);

        // The provider remounts its subtree on locale change; the spy
        // re-renders with the new locale code.
        expect(screen.getByTestId("locale-spy")).toHaveTextContent("zh-CN");
    });
});
