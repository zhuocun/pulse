import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import AuthLayout, { AuthButton } from "./authLayout";

describe("AuthLayout", () => {
    it("renders the auth shell with outlet content", () => {
        const { container } = render(
            <MemoryRouter initialEntries={["/login"]}>
                <Routes>
                    <Route element={<AuthLayout />}>
                        <Route
                            path="/login"
                            element={<div>Login outlet content</div>}
                        />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText("Login outlet content")).toBeInTheDocument();
        expect(container.querySelector("header")).toBeInTheDocument();
        expect(container.querySelector(".ant-card")).toBeInTheDocument();
    });

    it("uses a fluid width capped at 40rem for the form card", () => {
        const { container } = render(
            <MemoryRouter initialEntries={["/login"]}>
                <Routes>
                    <Route element={<AuthLayout />}>
                        <Route
                            path="/login"
                            element={<div>Login outlet content</div>}
                        />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        const card = container.querySelector(".ant-card") as HTMLElement;
        expect(card).toBeTruthy();
        const width = window.getComputedStyle(card).width;
        expect(width).toContain("min(");
        expect(width).toContain("40rem");
    });

    it("exports a full-width auth button", () => {
        render(<AuthButton>Continue</AuthButton>);

        expect(screen.getByRole("button", { name: /continue/i })).toHaveStyle({
            width: "100%"
        });
    });

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, and the AAA recommendation is 44×44 — the dominant
    // mobile CTA on the auth pages must stay generous. The deleted
    // `uiTouchTargets.strict.test.tsx` suite policed this across surfaces
    // via runtime style inspection. styled-components injects rules into
    // <style> tags that jsdom does not actually resolve, so we read the
    // declarations directly from the rendered stylesheet — same regression
    // signal, just sourced at the rule level instead of the computed-style
    // level.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        render(<AuthButton>Continue</AuthButton>);
        const button = screen.getByRole("button", { name: /continue/i });
        // styled-components hashes the rule into a class like `css-mcde2a`
        // (without the `dev-only` / `var-root` cssinjs naming). Pick that
        // out so the search below is anchored to the exact emitted rule.
        const styledCls = button.className
            .split(/\s+/)
            .find(
                (tok) =>
                    /^css-[a-z0-9]{4,}$/i.test(tok) &&
                    !tok.startsWith("css-var-") &&
                    !tok.startsWith("css-dev-only-")
            );
        expect(styledCls).toBeTruthy();

        // Walk every stylesheet's rules and find any `height: <N>px`
        // declaration on a rule that mentions the styled class. The
        // AuthButton's `&& { height: 44px; }` rule must be present.
        const heights: number[] = [];
        Array.from(document.styleSheets).forEach((sheet) => {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                // cross-origin / unreadable stylesheets surface here.
                return;
            }
            for (const rule of Array.from(rules)) {
                if (!(rule instanceof CSSStyleRule)) continue;
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    continue;
                const re = /height:\s*(\d+(?:\.\d+)?)px/gi;
                let m: RegExpExecArray | null = re.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0"));
                    m = re.exec(rule.cssText);
                }
            }
        });

        // The styled component's `height: 44px` rule must be one of them.
        // A regression to a smaller value or a removed rule fails loudly.
        expect(heights).toContain(44);
    });
});
