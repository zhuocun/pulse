import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { MemoryRouter } from "react-router-dom";

import { SettingsRow, SettingsSection } from ".";

expect.extend(toHaveNoViolations);

/**
 * Install the canonical AntD browser mocks (matchMedia + ResizeObserver)
 * so styled-component media queries and any AntD child render without
 * throwing in jsdom. Returns a cleanup that restores the originals so
 * sibling suites in the same process aren't observed through the mocks.
 * `matchMedia` is writable; `ResizeObserver` is non-writable on
 * `globalThis`, so we go through `Object.defineProperty`.
 */
const installAntdBrowserMocks = (): (() => void) => {
    const previousMatchMedia = window.matchMedia;
    const previousResizeObserver = window.ResizeObserver;
    (window as { matchMedia: typeof window.matchMedia }).matchMedia = ((
        query: string
    ) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    })) as unknown as typeof window.matchMedia;
    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }
    Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: ResizeObserverMock
    });
    return () => {
        (window as { matchMedia: typeof window.matchMedia }).matchMedia =
            previousMatchMedia;
        Object.defineProperty(window, "ResizeObserver", {
            configurable: true,
            writable: true,
            value: previousResizeObserver
        });
    };
};

const slots = (container: HTMLElement): NodeListOf<Element> =>
    container.querySelectorAll(".pulse-settings-slot");

describe("SettingsSection", () => {
    let restoreMocks: () => void;

    beforeEach(() => {
        restoreMocks = installAntdBrowserMocks();
    });

    afterEach(() => {
        restoreMocks();
    });

    it("renders an uppercase header, the grouped container, and a footer", () => {
        const { container } = render(
            <SettingsSection
                data-testid="section"
                footer="Choose how Pulse looks."
                header="Appearance"
            >
                <SettingsRow control={<input aria-label="x" />} label="Theme" />
            </SettingsSection>
        );

        const header = screen.getByText("Appearance");
        expect(header).toBeInTheDocument();
        // The uppercase look is a Tailwind utility; assert the class so the
        // iOS grouped-table context label contract holds.
        expect(header).toHaveClass("uppercase");

        expect(screen.getByText("Choose how Pulse looks.")).toBeInTheDocument();

        // The grouped container clips its rows so only the outer corners
        // round (radius.lg) — assert the rounding + clip utilities.
        const group = slots(container)[0]?.parentElement as HTMLElement;
        expect(group).toHaveClass("overflow-hidden");
        expect(group).toHaveClass("rounded-lg");
    });

    it("omits the header and footer when not provided", () => {
        render(
            <SettingsSection data-testid="section">
                <SettingsRow label="Solo" value="v" />
            </SettingsSection>
        );

        const section = screen.getByTestId("section");
        // Only the group wraps the single row — no header / footer nodes.
        expect(section.children).toHaveLength(1);
        expect(screen.getByText("Solo")).toBeInTheDocument();
    });

    it("gives N rows N slots with N-1 divider boundaries (last row none)", () => {
        const { container } = render(
            <SettingsSection header="Group">
                <SettingsRow label="One" value="1" />
                <SettingsRow label="Two" value="2" />
                <SettingsRow label="Three" value="3" />
            </SettingsSection>
        );

        const found = slots(container);
        expect(found).toHaveLength(3);
        // The hairline divider is a `> *:not(:last-child)::after`, so the
        // structural contract is: every slot except the last has a trailing
        // sibling. The last slot is the only one with none.
        const dividerBearing = Array.from(found).filter(
            (slot) => slot.nextElementSibling !== null
        );
        expect(dividerBearing).toHaveLength(2);
        expect(found[found.length - 1]?.nextElementSibling).toBeNull();
    });

    it("renders a control row with the control and NO chevron, not clickable", () => {
        render(
            <SettingsSection>
                <SettingsRow
                    control={<button type="button">Toggle</button>}
                    data-testid="settings-row-control"
                    label="Has control"
                />
            </SettingsSection>
        );

        const row = screen.getByTestId("settings-row-control");
        expect(
            screen.getByRole("button", { name: "Toggle" })
        ).toBeInTheDocument();
        // The control row itself is not a link or a button shell.
        expect(row.tagName).toBe("DIV");
        // No disclosure chevron alongside a control.
        expect(row.querySelector("[data-chevron]")).toBeNull();
    });

    it("renders a `to` navigating row as a focusable link with an aria-hidden chevron", () => {
        render(
            <MemoryRouter>
                <SettingsSection>
                    <SettingsRow
                        data-testid="settings-row-nav"
                        label="Account"
                        to="/account"
                    />
                </SettingsSection>
            </MemoryRouter>
        );

        const link = screen.getByRole("link", { name: /Account/ });
        expect(link).toHaveAttribute("href", "/account");
        link.focus();
        expect(link).toHaveFocus();

        // Disclosure chevron present and hidden from the a11y tree.
        const chevron = link.querySelector("[data-chevron]");
        expect(chevron).not.toBeNull();
        expect(chevron).toHaveAttribute("aria-hidden", "true");
    });

    it("renders an onActivate row as a button with a chevron and fires the callback", async () => {
        const onActivate = jest.fn();
        render(
            <SettingsSection>
                <SettingsRow
                    data-testid="settings-row-action"
                    label="Manage"
                    onActivate={onActivate}
                />
            </SettingsSection>
        );

        const button = screen.getByRole("button", { name: /Manage/ });
        expect(button).toHaveAttribute("type", "button");
        expect(button.querySelector("[data-chevron]")).not.toBeNull();

        button.click();
        expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it("renders a destructive onActivate row as a button with NO chevron", () => {
        render(
            <SettingsSection>
                <SettingsRow
                    data-testid="settings-row-logout"
                    destructive
                    label="Log out"
                    onActivate={jest.fn()}
                />
            </SettingsSection>
        );

        const button = screen.getByRole("button", { name: /Log out/ });
        expect(button).toHaveAttribute("type", "button");
        // Destructive actions read as a tinted label, not a drill-in.
        expect(button.querySelector("[data-chevron]")).toBeNull();
    });

    // W1-02 — a wide trailing control (the Theme / Language Segmented
    // pickers on phone) must wrap onto its own line instead of crushing
    // the leading icon: the row declares flex-wrap and the icon rides a
    // non-shrinking slot.
    it("wraps wide trailing controls instead of crushing the leading icon", () => {
        render(
            <SettingsSection>
                <SettingsRow
                    control={<input aria-label="theme control" />}
                    data-testid="settings-row-theme"
                    icon={<span data-testid="theme-icon" />}
                    label="Theme"
                />
            </SettingsSection>
        );

        const row = screen.getByTestId("settings-row-theme");
        expect(row).toHaveClass("flex-wrap");

        const iconSlot = screen.getByTestId("theme-icon")
            .parentElement as HTMLElement;
        // `flex-none` === `flex: 0 0 auto` — the icon slot never shrinks.
        expect(iconSlot).toHaveClass("flex-none");
    });

    it("passes data-testid through on the row element", () => {
        render(
            <SettingsSection>
                <SettingsRow
                    data-testid="settings-row-theme"
                    label="Theme"
                    value="Dark"
                />
            </SettingsSection>
        );

        expect(screen.getByTestId("settings-row-theme")).toBeInTheDocument();
    });

    it("flattens fragment-wrapped + conditional children into one slot each", () => {
        const aiAvailable = true;
        const { container } = render(
            <SettingsSection header="Group">
                <>
                    <SettingsRow label="Theme" value="Dark" />
                    {false}
                    {aiAvailable && <SettingsRow label="Copilot" value="On" />}
                    <SettingsRow label="Logout" value="" />
                </>
            </SettingsSection>
        );

        // Three real rows survive the falsy `{false}`; the fragment is
        // flattened so each leaf row gets its own slot + divider boundary.
        expect(slots(container)).toHaveLength(3);
        expect(screen.getByText("Theme")).toBeInTheDocument();
        expect(screen.getByText("Copilot")).toBeInTheDocument();
        expect(screen.getByText("Logout")).toBeInTheDocument();
    });

    it("drops a gated-off conditional row from the slot count", () => {
        const aiAvailable = false;
        const { container } = render(
            <SettingsSection>
                <SettingsRow label="Theme" value="Dark" />
                {aiAvailable && <SettingsRow label="Copilot" value="On" />}
            </SettingsSection>
        );

        expect(slots(container)).toHaveLength(1);
        expect(screen.queryByText("Copilot")).not.toBeInTheDocument();
    });

    it("does not crash on forced-colors / reduced-motion paths", () => {
        const restore = installAntdBrowserMocks();
        // matchMedia returns matches:false for every query in the mock, so
        // both the forced-colors and reduced-motion branches resolve to
        // their default (non-matching) path without throwing.
        expect(() =>
            render(
                <MemoryRouter>
                    <SettingsSection footer="Gloss" header="Group">
                        <SettingsRow label="Nav" to="/x" />
                        <SettingsRow
                            control={<input aria-label="ctrl" />}
                            label="Ctrl"
                        />
                    </SettingsSection>
                </MemoryRouter>
            )
        ).not.toThrow();
        restore();
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <MemoryRouter>
                <SettingsSection
                    footer="Choose how Pulse looks."
                    header="Appearance"
                >
                    <SettingsRow
                        control={
                            <button aria-label="Toggle theme" type="button">
                                Toggle
                            </button>
                        }
                        label="Theme"
                    />
                    <SettingsRow label="Account" to="/account" />
                    <SettingsRow label="Manage" onActivate={jest.fn()} />
                </SettingsSection>
            </MemoryRouter>
        );

        expect(await axe(container)).toHaveNoViolations();
    });
});
