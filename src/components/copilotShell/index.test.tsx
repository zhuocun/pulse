/**
 * CopilotShell unit tests — F-2: controlled tab switching.
 */
import { act, render, screen } from "@testing-library/react";

import CopilotShell from ".";

// AntD Grid requires matchMedia to be defined in jsdom.
beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: () => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: "",
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
});

const baseProps = {
    columns: [] as IColumn[],
    knownProjectIds: [] as string[],
    members: [] as IMember[],
    onClose: jest.fn(),
    project: null as IProject | null,
    tasks: [] as ITask[]
};

describe("CopilotShell", () => {
    it("renders the shell with the chat tab active by default", () => {
        render(<CopilotShell {...baseProps} open defaultTab="chat" />);
        // The active tab's panel should be visible; AntD renders active tab
        // items without display:none.
        const chatTab = screen.getByRole("tab", { name: /^chat$/i });
        expect(chatTab).toHaveAttribute("aria-selected", "true");
    });

    it("shows the brief tab when defaultTab='brief'", () => {
        render(<CopilotShell {...baseProps} open defaultTab="brief" />);
        const briefTab = screen.getByRole("tab", { name: /^brief$/i });
        expect(briefTab).toHaveAttribute("aria-selected", "true");
    });

    it("switches to the new defaultTab when it changes (F-2)", () => {
        const { rerender } = render(
            <CopilotShell {...baseProps} open defaultTab="chat" />
        );
        expect(screen.getByRole("tab", { name: /^chat$/i })).toHaveAttribute(
            "aria-selected",
            "true"
        );

        act(() => {
            rerender(<CopilotShell {...baseProps} open defaultTab="brief" />);
        });

        expect(screen.getByRole("tab", { name: /^brief$/i })).toHaveAttribute(
            "aria-selected",
            "true"
        );
        expect(screen.getByRole("tab", { name: /^chat$/i })).toHaveAttribute(
            "aria-selected",
            "false"
        );
    });
});
