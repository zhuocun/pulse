import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";

import useAuth from "../../utils/hooks/useAuth";

import TaskSearchPanel, { TaskSearchParam } from ".";

jest.mock("../../utils/hooks/useAuth");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    jwt: "token",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "t1",
    columnId: "col-1",
    coordinatorId: "u1",
    epic: "Checkout",
    index: 0,
    note: "Ship it",
    projectId: "p1",
    storyPoints: 3,
    taskName: "Build checkout",
    type: "Task",
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

const defaultParam: TaskSearchParam = {
    coordinatorId: "",
    taskName: "",
    type: ""
};

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

const renderPanel = ({
    loading = false,
    param = defaultParam,
    panelMembers = members,
    setParam = jest.fn(),
    panelTasks = [task(), task({ _id: "t2", coordinatorId: "u2", type: "Bug" })]
}: {
    loading?: boolean;
    param?: TaskSearchParam;
    panelMembers?: IMember[] | undefined;
    setParam?: jest.Mock;
    panelTasks?: ITask[];
} = {}) => {
    render(
        <TaskSearchPanel
            loading={loading}
            members={panelMembers}
            param={param}
            setParam={setParam}
            tasks={panelTasks}
        />
    );

    return { setParam };
};

const openSelect = (index: number) => {
    fireEvent.mouseDown(screen.getAllByRole("combobox")[index]);
};

const getRenderedOptionLabels = () =>
    Array.from(
        document.body.querySelectorAll(".ant-select-item-option-content")
    ).map((option) => option.textContent);

describe("TaskSearchPanel", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: "token",
            user: user()
        });
    });

    it("updates task name, coordinator, type, and reset filters", async () => {
        const setParam = jest.fn();
        const param = { coordinatorId: "", taskName: "checkout", type: "" };

        renderPanel({ param, setParam });

        fireEvent.change(screen.getByPlaceholderText("Search this board"), {
            target: { value: "invoice" }
        });

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: "",
            taskName: "invoice",
            type: ""
        });

        openSelect(0);
        fireEvent.click(await screen.findByText("Alice"));

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: "u1",
            taskName: "checkout",
            type: ""
        });

        openSelect(1);
        fireEvent.click(await screen.findByText("Bug"));

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: "",
            taskName: "checkout",
            type: "Bug"
        });

        fireEvent.click(screen.getByRole("button", { name: /reset filter/i }));

        expect(setParam).toHaveBeenLastCalledWith({
            coordinatorId: undefined,
            semanticIds: undefined,
            taskName: undefined,
            type: undefined
        });
    });

    it("builds unique coordinator options from tasks and members", async () => {
        renderPanel({
            panelTasks: [
                task({ _id: "t1", coordinatorId: "u1" }),
                task({ _id: "t2", coordinatorId: "u1" }),
                task({ _id: "t3", coordinatorId: "u2" })
            ]
        });

        openSelect(0);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(
                expect.arrayContaining(["Alice", "Bob"])
            );
        });
        expect(
            getRenderedOptionLabels().filter((label) => label === "Alice")
        ).toHaveLength(1);
        expect(
            getRenderedOptionLabels().filter((label) => label === "Bob")
        ).toHaveLength(1);
    });

    it("builds unique type options from tasks", async () => {
        renderPanel({
            panelTasks: [
                task({ _id: "t1", type: "Story" }),
                task({ _id: "t2", type: "Story" }),
                task({ _id: "t3", type: "Bug" })
            ]
        });

        openSelect(1);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(
                expect.arrayContaining(["Story", "Bug"])
            );
        });
        expect(
            getRenderedOptionLabels().filter((label) => label === "Story")
        ).toHaveLength(1);
        expect(
            getRenderedOptionLabels().filter((label) => label === "Bug")
        ).toHaveLength(1);
    });

    it("falls back to the current user and default task types", async () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: "token",
            user: user({
                _id: "current-user",
                email: "current@example.com",
                username: "Current User"
            })
        });

        renderPanel({
            panelMembers: undefined,
            panelTasks: []
        });

        openSelect(0);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toContain("Current User");
        });

        openSelect(1);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(
                expect.arrayContaining(["Task", "Bug"])
            );
        });
    });

    it("does not add a coordinator fallback when there is no current user", async () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: null,
            user: undefined
        });

        renderPanel({
            panelMembers: undefined,
            panelTasks: []
        });

        openSelect(0);

        await waitFor(() => {
            expect(getRenderedOptionLabels()).toEqual(["Coordinators"]);
        });
    });

    it("shows loading state for both selects", () => {
        const { container } = render(
            <TaskSearchPanel
                loading
                members={members}
                param={defaultParam}
                setParam={jest.fn()}
                tasks={[task()]}
            />
        );

        expect(container.querySelectorAll(".ant-select-loading")).toHaveLength(
            2
        );
    });

    it("keeps reset disabled while no filter chips are active", () => {
        renderPanel();
        expect(
            screen.getByRole("button", { name: /reset filter/i })
        ).toBeDisabled();
    });

    it("does not show chip Clear control with a single active chip", () => {
        renderPanel({
            param: { coordinatorId: "", taskName: "only", type: "" }
        });
        expect(
            screen.queryByRole("button", { name: /^clear$/i })
        ).not.toBeInTheDocument();
    });

    it("clears every chip dimension when Clear is used with multiple chips active", () => {
        const setParam = jest.fn();
        renderPanel({
            param: {
                coordinatorId: "u1",
                semanticIds: "sem",
                taskName: "inv",
                type: "Bug"
            },
            setParam
        });

        fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));

        expect(setParam).toHaveBeenCalledWith({
            coordinatorId: undefined,
            semanticIds: undefined,
            taskName: undefined,
            type: undefined
        });
    });

    it("exposes a labelled search region containing reset and active filters", () => {
        renderPanel({
            param: {
                coordinatorId: "u1",
                taskName: "x",
                type: ""
            }
        });

        const region = screen.getByRole("search", { name: /filter tasks/i });
        expect(region).toHaveAttribute(
            "aria-labelledby",
            "task-search-panel-filter-label"
        );
        expect(
            document.getElementById("task-search-panel-filter-label")
        ).toHaveTextContent(/filter tasks/i);
        expect(
            within(region).getByRole("button", { name: /reset filter/i })
        ).toBeEnabled();
        expect(
            within(region).getByRole("region", { name: /active filters/i })
        ).toBeInTheDocument();
    });
});
