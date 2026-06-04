import { act, render, screen, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { microcopy } from "../../constants/microcopy";
import { SHORTCUTS, describeShortcut } from "../../constants/shortcuts";

import ShortcutHelp from ".";

expect.extend(toHaveNoViolations);

/** AntD Modal touches matchMedia / offsetHeight; install canonical mocks. */
const installAntdMocks = () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        value: 800
    });
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const pressKey = (init: KeyboardEventInit) => {
    act(() => {
        window.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                ...init
            })
        );
    });
};

describe("ShortcutHelp", () => {
    beforeAll(() => {
        installAntdMocks();
    });

    it("opens on the `?` global shortcut and lists the whole catalog", () => {
        render(<ShortcutHelp />);
        // Closed initially.
        expect(
            screen.queryByText(microcopy.shortcuts.dialogTitle)
        ).not.toBeInTheDocument();

        pressKey({ key: "?" });

        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getByText(microcopy.shortcuts.dialogTitle)
        ).toBeInTheDocument();
        // Every catalog description is rendered.
        for (const entry of SHORTCUTS) {
            expect(
                within(dialog).getByText(describeShortcut(entry))
            ).toBeInTheDocument();
        }
    });

    it("renders combos as <kbd> tokens", () => {
        render(<ShortcutHelp />);
        pressKey({ key: "?" });
        const dialog = screen.getByRole("dialog");
        // The command-palette combo renders K as a <kbd>.
        const kbds = dialog.querySelectorAll("kbd");
        expect(kbds.length).toBeGreaterThan(0);
        const text = Array.from(kbds).map((k) => k.textContent);
        expect(text).toContain("?");
    });

    it("does not open when `?` is typed inside an input field", () => {
        render(
            <>
                <input data-testid="field" />
                <ShortcutHelp />
            </>
        );
        const field = screen.getByTestId("field");
        field.focus();
        act(() => {
            field.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "?"
                })
            );
        });
        expect(
            screen.queryByText(microcopy.shortcuts.dialogTitle)
        ).not.toBeInTheDocument();
    });

    it("renders the scope group headings", () => {
        render(<ShortcutHelp open />);
        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getByText(microcopy.shortcuts.scopes.global)
        ).toBeInTheDocument();
        expect(
            within(dialog).getByText(microcopy.shortcuts.scopes.board)
        ).toBeInTheDocument();
    });

    it("supports controlled open + close", () => {
        const onClose = jest.fn();
        const { rerender } = render(<ShortcutHelp onClose={onClose} open />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        // In controlled mode the `?` shortcut is disabled (parent owns state).
        rerender(<ShortcutHelp onClose={onClose} open={false} />);
        expect(
            screen.queryByText(microcopy.shortcuts.dialogTitle)
        ).not.toBeInTheDocument();
    });

    it("has no axe violations when open", async () => {
        const { container } = render(<ShortcutHelp open />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
