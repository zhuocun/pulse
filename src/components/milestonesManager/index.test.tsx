import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { microcopy } from "../../constants/microcopy";
import { setActiveLocale } from "../../i18n/active";
import { DEFAULT_LOCALE } from "../../i18n/registry";
import useAuth from "../../utils/hooks/useAuth";
import useMilestoneMutations from "../../utils/hooks/useMilestoneMutations";
import useMilestones from "../../utils/hooks/useMilestones";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";

import MilestonesManager from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useMilestones");
jest.mock("../../utils/hooks/useMilestoneMutations");
jest.mock("../../utils/hooks/useProjectMembers");
jest.mock("../../utils/hooks/useReactQuery");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseMilestones = useMilestones as jest.MockedFunction<
    typeof useMilestones
>;
const mockedUseMutations = useMilestoneMutations as jest.MockedFunction<
    typeof useMilestoneMutations
>;
const mockedUseProjectMembers = useProjectMembers as jest.MockedFunction<
    typeof useProjectMembers
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;

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
};

const createMilestone = jest.fn();
const updateMilestone = jest.fn();
const removeMilestone = jest.fn();

const MANAGER_ID = "user-mike";

const milestones: IMilestone[] = [
    {
        _id: "ms-1",
        projectId: "project-1",
        name: "v1 launch",
        description: "Ship the MVP",
        startDate: "2026-01-01",
        dueDate: "2026-03-01",
        state: "open"
    },
    {
        _id: "ms-2",
        projectId: "project-1",
        name: "v2 polish",
        state: "closed"
    }
];

const roster: IProjectMember[] = [
    { _id: MANAGER_ID, username: "mike", email: "mike@x.io", role: "owner" },
    { _id: "user-ed", username: "ed", email: "ed@x.io", role: "editor" },
    { _id: "user-vi", username: "vi", email: "vi@x.io", role: "viewer" }
];

const setMilestones = (
    overrides: Partial<ReturnType<typeof useMilestones>> = {}
) => {
    mockedUseMilestones.mockReturnValue({
        data: milestones,
        isLoading: false,
        isError: false,
        ...overrides
    } as unknown as ReturnType<typeof useMilestones>);
};

const setRoster = (members: IProjectMember[] = roster) => {
    mockedUseProjectMembers.mockReturnValue({
        data: members
    } as unknown as ReturnType<typeof useProjectMembers>);
};

const setProject = (managerId: string = MANAGER_ID) => {
    mockedUseReactQuery.mockReturnValue({
        data: {
            _id: "project-1",
            projectName: "Atlas",
            managerId,
            organization: "Org"
        }
    } as unknown as ReturnType<typeof useReactQuery>);
};

const setUser = (id: string | undefined) => {
    mockedUseAuth.mockReturnValue({
        user: id
            ? ({
                  _id: id,
                  username: id,
                  email: `${id}@example.com`,
                  likedProjects: []
              } as IUser)
            : undefined,
        isAuthenticated: Boolean(id),
        logout: jest.fn()
    });
};

const renderManager = () => render(<MilestonesManager projectId="project-1" />);

const rowFor = (milestoneId: string): HTMLElement => {
    const rows = screen.getAllByTestId("milestone-row");
    const row = rows.find(
        (candidate) =>
            candidate.getAttribute("data-milestone-id") === milestoneId
    );
    if (!row) throw new Error(`No row for ${milestoneId}`);
    return row;
};

describe("MilestonesManager", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        setMilestones();
        setRoster();
        setProject();
        setUser("user-ed"); // editor → can manage
        mockedUseMutations.mockReturnValue({
            createMilestone,
            isCreating: false,
            updateMilestone,
            isUpdating: false,
            removeMilestone,
            isRemoving: false
        });
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("renders a load-error alert when the list query failed", () => {
        setMilestones({ isError: true, data: undefined });
        renderManager();
        expect(screen.getByTestId("milestones-load-error")).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.milestones.loadError)
        ).toBeInTheDocument();
    });

    it("renders a loading skeleton before the list resolves", () => {
        setMilestones({ isLoading: true, data: undefined });
        renderManager();
        expect(screen.getByTestId("milestones-loading")).toBeInTheDocument();
    });

    it("renders an empty hint when there are no milestones", () => {
        setMilestones({ data: [] });
        renderManager();
        expect(screen.getByTestId("milestones-empty")).toBeInTheDocument();
        expect(screen.queryByTestId("milestone-row")).not.toBeInTheDocument();
    });

    it("renders a row per milestone with name, state tag, and dates", () => {
        renderManager();
        expect(screen.getByTestId("milestones-manager")).toBeInTheDocument();
        const rows = screen.getAllByTestId("milestone-row");
        expect(rows).toHaveLength(2);

        const first = rowFor("ms-1");
        expect(within(first).getByText("v1 launch")).toBeInTheDocument();
        expect(within(first).getByText("Ship the MVP")).toBeInTheDocument();
        expect(
            within(first).getByTestId("milestone-state-tag")
        ).toHaveTextContent(microcopy.milestones.states.open);
        expect(
            within(first).getByTestId("milestone-date-range")
        ).toHaveTextContent("2026-01-01 → 2026-03-01");

        expect(
            within(rowFor("ms-2")).getByTestId("milestone-state-tag")
        ).toHaveTextContent(microcopy.milestones.states.closed);
    });

    it("creates a milestone with the trimmed name + selected state", async () => {
        createMilestone.mockResolvedValue("Milestone created");
        renderManager();

        fireEvent.change(screen.getByTestId("milestone-add-name"), {
            target: { value: "  v3 hardening  " }
        });
        fireEvent.click(screen.getByTestId("milestone-add-submit"));

        await waitFor(() =>
            expect(createMilestone).toHaveBeenCalledWith({
                name: "v3 hardening",
                description: undefined,
                startDate: undefined,
                dueDate: undefined,
                state: "open"
            })
        );
    });

    it("does not create when the name is blank", () => {
        renderManager();
        // Submit is disabled with an empty name.
        expect(screen.getByTestId("milestone-add-submit")).toBeDisabled();
        fireEvent.click(screen.getByTestId("milestone-add-submit"));
        expect(createMilestone).not.toHaveBeenCalled();
    });

    it("toggles a milestone's state through the row Select (fires PUT)", async () => {
        updateMilestone.mockResolvedValue("Milestone updated");
        renderManager();

        const select = within(rowFor("ms-1")).getByTestId(
            "milestone-state-select"
        );
        fireEvent.mouseDown(within(select).getByRole("combobox"));
        fireEvent.click(
            await screen.findByText(microcopy.milestones.states.closed, {
                selector: ".ant-select-item-option-content"
            })
        );

        await waitFor(() =>
            expect(updateMilestone).toHaveBeenCalledWith({
                _id: "ms-1",
                state: "closed"
            })
        );
    });

    it("deletes a milestone behind a Popconfirm", async () => {
        removeMilestone.mockResolvedValue("Milestone deleted");
        renderManager();

        fireEvent.click(within(rowFor("ms-1")).getByTestId("milestone-delete"));
        fireEvent.click(
            await screen.findByRole("button", {
                name: microcopy.milestones.delete
            })
        );

        await waitFor(() =>
            expect(removeMilestone).toHaveBeenCalledWith("ms-1")
        );
    });

    it("renames a milestone through the inline editor (PUT with new name)", async () => {
        updateMilestone.mockResolvedValue("Milestone updated");
        renderManager();

        fireEvent.click(within(rowFor("ms-1")).getByTestId("milestone-edit"));
        const nameInput = within(rowFor("ms-1")).getByTestId(
            "milestone-edit-name"
        );
        fireEvent.change(nameInput, { target: { value: "v1 GA" } });
        fireEvent.click(
            within(rowFor("ms-1")).getByTestId("milestone-edit-save")
        );

        await waitFor(() =>
            expect(updateMilestone).toHaveBeenCalledWith(
                expect.objectContaining({ _id: "ms-1", name: "v1 GA" })
            )
        );
    });

    it("renders the list read-only for a viewer (no write controls)", () => {
        setUser("user-vi"); // viewer → cannot manage
        renderManager();
        expect(screen.getAllByTestId("milestone-row")).toHaveLength(2);
        // State renders as a tag, never a Select; no edit / delete / add.
        expect(
            screen.queryByTestId("milestone-state-select")
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId("milestone-edit")).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("milestone-delete")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("milestone-add-name")
        ).not.toBeInTheDocument();
        expect(screen.getAllByTestId("milestone-state-tag").length).toBe(2);
    });

    it("stays read-only until the project query resolves (manager id unknown)", () => {
        mockedUseReactQuery.mockReturnValue({
            data: undefined
        } as unknown as ReturnType<typeof useReactQuery>);
        setUser("user-ed"); // editor per roster role
        renderManager();
        expect(
            screen.queryByTestId("milestone-add-name")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("milestone-state-select")
        ).not.toBeInTheDocument();
    });

    it("treats the project manager as a manager who can write", () => {
        setUser(MANAGER_ID);
        renderManager();
        expect(screen.getByTestId("milestone-add-name")).toBeInTheDocument();
        expect(
            within(rowFor("ms-1")).getByTestId("milestone-state-select")
        ).toBeInTheDocument();
    });

    it("renders localized copy after switching to zh-CN", () => {
        setActiveLocale("zh-CN");
        renderManager();
        expect(screen.getByTestId("milestone-add-submit")).toHaveTextContent(
            "添加里程碑"
        );
        expect(
            within(rowFor("ms-2")).getByTestId("milestone-state-tag")
        ).toHaveTextContent("已关闭");
    });

    it("has no axe violations with a populated, manageable list", async () => {
        const { container } = renderManager();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
