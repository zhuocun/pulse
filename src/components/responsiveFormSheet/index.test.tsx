import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";

import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import ResponsiveFormSheet from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useIsPhoneChrome");
jest.mock("../../utils/hooks/useReducedMotion");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseReducedMotion = useReducedMotion as jest.MockedFunction<
    typeof useReducedMotion
>;

/**
 * Install the canonical AntD browser mocks so the desktop `<Modal>`
 * branch renders without throwing on `matchMedia` / `ResizeObserver`
 * accesses. Returns a cleanup function that restores the originals so
 * sibling suites in the same process aren't observed through the mocks.
 * Copied from `sheet/index.test.tsx` (same primitive contract).
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

interface HarnessProps {
    open?: boolean;
    onClose?: () => void;
    "data-testid"?: string;
}

const Harness: React.FC<HarnessProps> = ({
    open = true,
    onClose = jest.fn(),
    "data-testid": dataTestid = "form-sheet"
}) => (
    <ResponsiveFormSheet
        data-testid={dataTestid}
        footer={
            <button type="button" data-testid="form-sheet-save">
                Save
            </button>
        }
        onClose={onClose}
        open={open}
        title="Edit project"
        width={520}
    >
        <label>
            Project name
            <input type="text" />
        </label>
    </ResponsiveFormSheet>
);

describe("ResponsiveFormSheet — phone branch", () => {
    let restoreAntdBrowserMocks: () => void;
    beforeAll(() => {
        restoreAntdBrowserMocks = installAntdBrowserMocks();
    });
    afterAll(() => {
        restoreAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
    });

    it("renders the Sheet surface at the medium detent with title, footer, and children", () => {
        render(<Harness />);

        const surface = screen.getByTestId("form-sheet-surface");
        expect(surface).toBeInTheDocument();
        expect(surface).toHaveAttribute("data-detent", "medium");
        // Title slot, footer node, and child field are all present.
        expect(screen.getByText("Edit project")).toBeInTheDocument();
        expect(screen.getByTestId("form-sheet-save")).toBeInTheDocument();
        expect(screen.getByText("Project name")).toBeInTheDocument();
    });

    it("presents the surface as an accessible dialog named by the title", () => {
        render(<Harness />);

        const dialog = screen.getByRole("dialog", { name: "Edit project" });
        expect(dialog).toBe(screen.getByTestId("form-sheet-surface"));
    });

    it("renders only the Sheet surface (not the desktop Dialog) on phone", () => {
        render(<Harness />);
        // The phone branch renders exactly one dialog — the detent-aware
        // Sheet surface; the desktop Dialog (which carries no `data-detent`)
        // is never mounted.
        const dialogs = screen.getAllByRole("dialog");
        expect(dialogs).toHaveLength(1);
        expect(dialogs[0]).toHaveAttribute("data-detent", "medium");
    });

    it("unmounts the surface when closed", () => {
        render(<Harness open={false} />);
        expect(
            screen.queryByTestId("form-sheet-surface")
        ).not.toBeInTheDocument();
    });

    it("passes axe with no a11y violations in the phone branch", async () => {
        const { baseElement } = render(<Harness />);
        const results = await axe(baseElement);
        expect(results).toHaveNoViolations();
    });
});

describe("ResponsiveFormSheet — desktop branch", () => {
    let restoreAntdBrowserMocks: () => void;
    beforeAll(() => {
        restoreAntdBrowserMocks = installAntdBrowserMocks();
    });
    afterAll(() => {
        restoreAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
    });

    it("renders a Dialog with title, footer, and children", () => {
        render(<Harness />);

        const dialog = screen.getByRole("dialog", { name: "Edit project" });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByTestId("form-sheet-save")).toBeInTheDocument();
        expect(screen.getByText("Project name")).toBeInTheDocument();
    });

    it("does not render the animated Sheet surface on desktop", () => {
        render(<Harness />);
        expect(
            screen.queryByTestId("form-sheet-surface")
        ).not.toBeInTheDocument();
    });
});
