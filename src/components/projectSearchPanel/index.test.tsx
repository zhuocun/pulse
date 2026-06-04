import { act, fireEvent, render, screen } from "@testing-library/react";

import ProjectSearchPanel from ".";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const members = [
    member(),
    member({
        _id: "u2",
        email: "bob@example.com",
        username: "Bob"
    })
];

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

describe("ProjectSearchPanel", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    it("shows the current project name and updates it from the search input", () => {
        // URL stays the source of truth: the input writes the new value to
        // `setParam` on every keystroke (the projects page debounces the
        // *refetch* off that param, not the URL write — see
        // `pages/project.test.tsx`).
        const setParam = jest.fn();
        const param = { projectName: "Roadmap", managerId: "u1" };

        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={param}
                setParam={setParam}
            />
        );

        expect(screen.getByPlaceholderText("Search this list")).toHaveValue(
            "Roadmap"
        );

        fireEvent.change(screen.getByPlaceholderText("Search this list"), {
            target: { value: "Billing" }
        });

        expect(setParam).toHaveBeenCalledWith({
            managerId: "u1",
            projectName: "Billing"
        });
    });

    /*
     * Loading affordance (ui-todo §9). The "filtering…" spinner mirrors the
     * 300 ms debounce the projects page applies before it refetches: it
     * surfaces while the just-typed value has out-run the debounced one and
     * clears once the window closes (the moment the page would fire the
     * query). The filter/URL flow itself is untouched.
     */
    it("shows the filtering spinner while the debounce window is open, then clears it", () => {
        jest.useFakeTimers();
        try {
            // At rest (value already settled at mount) → no spinner.
            const { rerender } = render(
                <ProjectSearchPanel
                    loading={false}
                    members={members}
                    param={{ projectName: "", managerId: "" }}
                    setParam={jest.fn()}
                />
            );
            expect(
                screen.queryByLabelText("Filtering projects…")
            ).not.toBeInTheDocument();

            // A new committed value (the URL just changed from a keystroke)
            // out-runs the debounced value → spinner shows.
            rerender(
                <ProjectSearchPanel
                    loading={false}
                    members={members}
                    param={{ projectName: "Bil", managerId: "" }}
                    setParam={jest.fn()}
                />
            );
            expect(
                screen.getByLabelText("Filtering projects…")
            ).toBeInTheDocument();

            // Once the debounce window closes the spinner clears (the page
            // would fire its refetch at this point).
            act(() => {
                jest.advanceTimersByTime(300);
            });
            expect(
                screen.queryByLabelText("Filtering projects…")
            ).not.toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it("shows the selected manager name when the manager id matches", () => {
        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "", managerId: "u2" }}
                setParam={jest.fn()}
            />
        );

        // The manager name appears both inside the Select trigger and in the
        // Active filters chip row, so look for at least one match instead of
        // a unique node.
        expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(1);
    });

    it("renders manager options and updates the manager id on selection", async () => {
        const setParam = jest.fn();
        const param = { projectName: "Roadmap", managerId: "" };

        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={param}
                setParam={setParam}
            />
        );

        fireEvent.mouseDown(screen.getByRole("combobox"));

        expect(screen.getAllByText("Managers").length).toBeGreaterThanOrEqual(
            1
        );
        expect(await screen.findByText("Alice")).toBeInTheDocument();

        fireEvent.click(await screen.findByText("Bob"));

        expect(setParam).toHaveBeenCalledWith({
            managerId: "u2",
            projectName: "Roadmap"
        });
    });

    it("shows the placeholder and loading state while managers load", () => {
        const { container } = render(
            <ProjectSearchPanel
                loading
                members={members}
                param={{ projectName: "", managerId: "u1" }}
                setParam={jest.fn()}
            />
        );

        expect(screen.getByLabelText("Filter by manager")).toBeInTheDocument();
        expect(
            container.querySelector(".ant-select-loading")
        ).toBeInTheDocument();
    });

    /*
     * Phase 4.2 — favorited toggle + saved-default management. The
     * `onFavoritedOnlyChange` prop drives the toggle render; the
     * `onSaveDefault` / `onResetToDefault` / `hasSavedDefaults` props
     * gate the defaults toolbar below the filter chips. Legacy
     * callers that pass none of these get the original panel shape.
     */
    it("renders the favorited-only toggle and calls onFavoritedOnlyChange when clicked", () => {
        const onFavoritedOnlyChange = jest.fn();
        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "", managerId: "" }}
                setParam={jest.fn()}
                favoritedOnly={false}
                onFavoritedOnlyChange={onFavoritedOnlyChange}
            />
        );

        const toggle = screen.getByRole("button", {
            name: /show only favorited projects/i
        });
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(toggle);
        expect(onFavoritedOnlyChange).toHaveBeenCalledWith(true);
    });

    it("renders a favorited chip when favoritedOnly is true and dismissing it clears the toggle", () => {
        const onFavoritedOnlyChange = jest.fn();
        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "", managerId: "" }}
                setParam={jest.fn()}
                favoritedOnly
                onFavoritedOnlyChange={onFavoritedOnlyChange}
            />
        );

        // The chip surfaces "Favorited" as the dimension label with
        // "Yes" as the value (boolean dimensions don't carry a
        // distinct value beyond on/off).
        expect(screen.getByText("Favorited:")).toBeInTheDocument();
        expect(screen.getByText("Yes")).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /remove favorited filter/i })
        );
        expect(onFavoritedOnlyChange).toHaveBeenCalledWith(false);
    });

    it("calls onSaveDefault when 'Save as default' is clicked", () => {
        const onSaveDefault = jest.fn();
        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "Road", managerId: "u1" }}
                setParam={jest.fn()}
                favoritedOnly
                onFavoritedOnlyChange={jest.fn()}
                onSaveDefault={onSaveDefault}
            />
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: /save current filters as default/i
            })
        );
        expect(onSaveDefault).toHaveBeenCalledTimes(1);
    });

    it("renders 'Reset to default' only when hasSavedDefaults is true", () => {
        const onResetToDefault = jest.fn();
        const { rerender } = render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "", managerId: "" }}
                setParam={jest.fn()}
                onSaveDefault={jest.fn()}
                onResetToDefault={onResetToDefault}
                hasSavedDefaults={false}
            />
        );

        // No saved default → reset button must be hidden.
        expect(
            screen.queryByRole("button", {
                name: /reset filters to saved default/i
            })
        ).not.toBeInTheDocument();

        // Flip the prop — reset button must now appear.
        rerender(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "", managerId: "" }}
                setParam={jest.fn()}
                onSaveDefault={jest.fn()}
                onResetToDefault={onResetToDefault}
                hasSavedDefaults
            />
        );

        fireEvent.click(
            screen.getByRole("button", {
                name: /reset filters to saved default/i
            })
        );
        expect(onResetToDefault).toHaveBeenCalledTimes(1);
    });

    it("does not render the defaults toolbar when no save/reset callbacks are wired", () => {
        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "Road", managerId: "u1" }}
                setParam={jest.fn()}
            />
        );

        expect(
            screen.queryByRole("button", {
                name: /save current filters as default/i
            })
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", {
                name: /reset filters to saved default/i
            })
        ).not.toBeInTheDocument();
    });

    /*
     * Phase 4.2 review follow-up — the DefaultsToolbar buttons render as
     * compact `type="link"` AntD elements, well under the WCAG 2.5.8
     * 44×44 touch target minimum on coarse-pointer (touch) devices. A
     * `::before` pseudo-element expander sits on the wrapping
     * `TouchTargetSlot` and is gated on `@media (pointer: coarse)` so
     * desktop pointers stay precise. JSDOM doesn't evaluate the media
     * query at layout time; the `data-touch-hit-area="44"` marker on
     * the wrapper is the stable contract — a refactor that drops the
     * wrapper would lose the marker AND the rule, tripping this
     * assertion loudly. Mirrors the columnReadinessPill convention
     * (PR #308 Followup B → PR #309 review).
     */
    it("wraps each defaults-toolbar button in a 44×44 touch-target slot on coarse pointers", () => {
        render(
            <ProjectSearchPanel
                loading={false}
                members={members}
                param={{ projectName: "Road", managerId: "u1" }}
                setParam={jest.fn()}
                favoritedOnly
                onFavoritedOnlyChange={jest.fn()}
                hasSavedDefaults
                onSaveDefault={jest.fn()}
                onResetToDefault={jest.fn()}
                onClearSavedDefault={jest.fn()}
            />
        );

        // All three buttons (save / reset / clear) wear the slot when
        // their callback + visibility gate is satisfied. The slot is
        // the styled `<span>` that immediately wraps the AntD
        // Tooltip / Button.
        const slots = document.querySelectorAll('[data-touch-hit-area="44"]');
        expect(slots.length).toBe(3);

        // Each slot must wrap an actual interactive button — otherwise
        // the expander is hanging in the DOM with no target.
        slots.forEach((slot) => {
            expect(slot.querySelector("button")).not.toBeNull();
        });
    });
});
