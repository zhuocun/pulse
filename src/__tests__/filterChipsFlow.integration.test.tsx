/**
 * Integration test for the active-filters chip dismissal flow.
 *
 * Validates the contract between `FilterChips` and the search panels that
 * mount it (`ProjectSearchPanel`). The chips render the live param state
 * from the parent; dismissing a chip must flow back through `setParam`
 * and clear only that dimension. The "Clear" CTA must reset every
 * dimension at once. These end-to-end wiring expectations would silently
 * regress if either side moved (e.g. a refactor that swapped FilterChips
 * for a one-line summary) so we exercise them at the integration seam.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import ProjectSearchPanel, {
    type ProjectSearchParam
} from "../components/projectSearchPanel";

const installAntdBrowserMocks = () => {
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

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

const members: IMember[] = [
    {
        _id: "u1",
        email: "alice@example.com",
        username: "Alice"
    },
    {
        _id: "u2",
        email: "bob@example.com",
        username: "Bob"
    }
];

const Harness = ({
    initialParam
}: {
    initialParam: Partial<ProjectSearchParam>;
}) => {
    const [param, setParam] = useState<ProjectSearchParam>({
        projectName: null,
        managerId: null,
        semanticIds: null,
        ...initialParam
    });
    return (
        <>
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={param}
                setParam={(next) => setParam((prev) => ({ ...prev, ...next }))}
            />
            <pre data-testid="param-state">{JSON.stringify(param)}</pre>
        </>
    );
};

describe("FilterChips flow through ProjectSearchPanel", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    it("hides the active-filters region when no filter is set", () => {
        render(<Harness initialParam={{}} />);
        // No chips rendered → no region.
        expect(
            screen.queryByRole("region", { name: /active filters/i })
        ).not.toBeInTheDocument();
    });

    it("renders one chip per active dimension and surfaces selected values", () => {
        render(
            <Harness
                initialParam={{
                    projectName: "Roadmap",
                    managerId: "u2"
                }}
            />
        );

        const region = screen.getByRole("region", { name: /active filters/i });
        expect(region).toHaveTextContent(/Roadmap/);
        // Manager chip should show the resolved username, not the raw id.
        expect(region).toHaveTextContent(/Bob/);
        expect(region).not.toHaveTextContent("u2");
    });

    it("dismissing a single chip clears only that dimension on the parent", async () => {
        const user = userEvent.setup();
        render(
            <Harness
                initialParam={{
                    projectName: "Roadmap",
                    managerId: "u1"
                }}
            />
        );

        await user.click(
            screen.getByRole("button", { name: /remove search filter/i })
        );

        const state = JSON.parse(
            screen.getByTestId("param-state").textContent ?? "{}"
        );
        expect(state.projectName).toBe("");
        // Manager filter survives.
        expect(state.managerId).toBe("u1");
    });

    it("clear-all wipes every dimension when 2+ chips are active", async () => {
        const user = userEvent.setup();
        render(
            <Harness
                initialParam={{
                    projectName: "Roadmap",
                    managerId: "u2",
                    semanticIds: "s1"
                }}
            />
        );

        // Should now show 3 chips + a Clear control.
        const clearAll = screen.getByRole("button", { name: /^clear$/i });
        await user.click(clearAll);

        const state = JSON.parse(
            screen.getByTestId("param-state").textContent ?? "{}"
        );
        expect(state.projectName).toBe("");
        expect(state.managerId).toBe("");
        expect(state.semanticIds).toBeUndefined();
    });

    it("typing in the search input adds a chip on the next render", () => {
        render(<Harness initialParam={{}} />);

        // No chips initially.
        expect(
            screen.queryByRole("region", { name: /active filters/i })
        ).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("Search this list"), {
            target: { value: "Billing" }
        });

        const region = screen.getByRole("region", { name: /active filters/i });
        expect(region).toHaveTextContent(/Billing/);
        // No "Clear" yet — only one chip is active.
        expect(
            screen.queryByRole("button", { name: /^clear$/i })
        ).not.toBeInTheDocument();
    });
});
