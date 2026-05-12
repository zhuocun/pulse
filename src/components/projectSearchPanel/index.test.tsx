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

    it("debounces committing the project name to setParam while keeping the input responsive", () => {
        jest.useFakeTimers();
        try {
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

            expect(screen.getByPlaceholderText("Search this list")).toHaveValue(
                "Billing"
            );
            expect(setParam).not.toHaveBeenCalled();

            act(() => {
                jest.advanceTimersByTime(300);
            });

            expect(setParam).toHaveBeenCalledTimes(1);
            expect(setParam).toHaveBeenCalledWith({ projectName: "Billing" });
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not apply a stale debounced name after the project chip is dismissed", () => {
        jest.useFakeTimers();
        try {
            const setParam = jest.fn();
            const param = { managerId: "", projectName: "Road" };

            render(
                <ProjectSearchPanel
                    loading={false}
                    members={members}
                    param={param}
                    setParam={setParam}
                />
            );

            fireEvent.change(screen.getByPlaceholderText("Search this list"), {
                target: { value: "stale" }
            });

            fireEvent.click(
                screen.getByRole("button", { name: "Remove Search filter" })
            );

            act(() => {
                jest.advanceTimersByTime(400);
            });

            expect(
                setParam.mock.calls.some(
                    (call) => call[0]?.projectName === "stale"
                )
            ).toBe(false);
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
        expect(screen.getByPlaceholderText("Search this list")).toBeDisabled();
        expect(
            container.querySelector(".ant-input-suffix .ant-spin")
        ).toBeInTheDocument();
    });
});
