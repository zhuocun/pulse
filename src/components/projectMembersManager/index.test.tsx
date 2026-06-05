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
import useMembersList from "../../utils/hooks/useMembersList";
import useProjectMemberMutations from "../../utils/hooks/useProjectMemberMutations";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";

import ProjectMembersManager from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useMembersList");
jest.mock("../../utils/hooks/useProjectMembers");
jest.mock("../../utils/hooks/useProjectMemberMutations");
jest.mock("../../utils/hooks/useReactQuery");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseMembersList = useMembersList as jest.MockedFunction<
    typeof useMembersList
>;
const mockedUseProjectMembers = useProjectMembers as jest.MockedFunction<
    typeof useProjectMembers
>;
const mockedUseMutations = useProjectMemberMutations as jest.MockedFunction<
    typeof useProjectMemberMutations
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

const addMember = jest.fn();
const updateMemberRole = jest.fn();
const removeMember = jest.fn();

const MANAGER_ID = "user-mike";

const roster: IProjectMember[] = [
    { _id: MANAGER_ID, username: "mike", email: "mike@x.io", role: "owner" },
    { _id: "user-alice", username: "alice", email: "a@x.io", role: "owner" },
    { _id: "user-bob", username: "bob", email: "b@x.io", role: "editor" }
];

const directory: IMember[] = [
    { _id: MANAGER_ID, username: "mike", email: "mike@x.io" },
    { _id: "user-alice", username: "alice", email: "a@x.io" },
    { _id: "user-bob", username: "bob", email: "b@x.io" },
    { _id: "user-carol", username: "carol", email: "carol@x.io" },
    { _id: "user-dave", username: "dave", email: "dave@x.io" }
];

const setRoster = (
    overrides: Partial<ReturnType<typeof useProjectMembers>> = {}
) => {
    mockedUseProjectMembers.mockReturnValue({
        data: roster,
        isLoading: false,
        isError: false,
        ...overrides
    } as unknown as ReturnType<typeof useProjectMembers>);
};

const setDirectory = (members: IMember[] = directory) => {
    mockedUseMembersList.mockReturnValue({
        data: members
    } as unknown as ReturnType<typeof useMembersList>);
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

const renderManager = () =>
    render(<ProjectMembersManager projectId="project-1" />);

const rowFor = (memberId: string): HTMLElement => {
    const rows = screen.getAllByTestId("member-row");
    const row = rows.find(
        (candidate) => candidate.getAttribute("data-member-id") === memberId
    );
    if (!row) throw new Error(`No row for ${memberId}`);
    return row;
};

describe("ProjectMembersManager", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        setRoster();
        setDirectory();
        setProject();
        setUser("user-alice");
        mockedUseMutations.mockReturnValue({
            addMember,
            isAdding: false,
            updateMemberRole,
            isUpdating: false,
            removeMember,
            isRemoving: false
        });
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("renders a load-error alert when the roster query failed", () => {
        setRoster({ isError: true, data: undefined });
        renderManager();
        expect(screen.getByTestId("members-load-error")).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.members.loadError)
        ).toBeInTheDocument();
    });

    it("renders a loading skeleton before the roster resolves", () => {
        setRoster({ isLoading: true, data: undefined });
        renderManager();
        expect(screen.getByTestId("members-loading")).toBeInTheDocument();
    });

    it("renders a row per member with name, email, and a role control for an owner", () => {
        renderManager();
        const rows = screen.getAllByTestId("member-row");
        expect(rows).toHaveLength(3);
        expect(within(rowFor("user-bob")).getByText("bob")).toBeInTheDocument();
        expect(
            within(rowFor("user-bob")).getByText("b@x.io")
        ).toBeInTheDocument();
        // A manageable, non-manager row exposes a role Select.
        expect(
            within(rowFor("user-bob")).getByTestId("member-role-select")
        ).toBeInTheDocument();
    });

    it("disables role-change + remove and shows a badge for the manager row", () => {
        renderManager();
        const managerRow = rowFor(MANAGER_ID);
        // No editable role Select — the manager's role is shown as a tag.
        expect(
            within(managerRow).queryByTestId("member-role-select")
        ).not.toBeInTheDocument();
        expect(
            within(managerRow).getByTestId("member-manager-badge")
        ).toBeInTheDocument();
        // The remove affordance is present but disabled.
        expect(within(managerRow).getByTestId("member-remove")).toBeDisabled();
    });

    it("renders the roster read-only for a non-owner", () => {
        setUser("user-bob"); // editor → cannot manage
        renderManager();
        expect(
            screen.getByTestId("members-read-only-hint")
        ).toBeInTheDocument();
        // Roles render as tags, never selects, and no remove buttons.
        expect(
            screen.queryByTestId("member-role-select")
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId("member-remove")).not.toBeInTheDocument();
        // No add section for a viewer.
        expect(screen.queryByTestId("member-add-user")).not.toBeInTheDocument();
        expect(screen.getAllByTestId("member-role-tag").length).toBe(3);
    });

    it("treats the project manager as an owner who can manage", () => {
        setUser(MANAGER_ID); // manager → canManage even though it's their row
        renderManager();
        expect(
            screen.queryByTestId("members-read-only-hint")
        ).not.toBeInTheDocument();
        // bob (non-manager) gets an editable role Select.
        expect(
            within(rowFor("user-bob")).getByTestId("member-role-select")
        ).toBeInTheDocument();
    });

    it("stays read-only until the project query resolves (manager id unknown)", () => {
        // Owner roster role, but the `projects` query hasn't landed yet, so
        // `managerId` is unknown. The manager row can't be identified, so we
        // fail closed: no editable controls until the project resolves — a
        // cold deep-link to /members can race the roster ahead of the project.
        mockedUseReactQuery.mockReturnValue({
            data: undefined
        } as unknown as ReturnType<typeof useReactQuery>);
        setUser("user-alice"); // owner per roster role
        renderManager();
        expect(
            screen.getByTestId("members-read-only-hint")
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId("member-role-select")
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId("member-remove")).not.toBeInTheDocument();
        expect(screen.queryByTestId("member-add-user")).not.toBeInTheDocument();
    });

    it("changes a member's role through the Select", async () => {
        updateMemberRole.mockResolvedValue("Member updated");
        renderManager();

        const select = within(rowFor("user-bob")).getByTestId(
            "member-role-select"
        );
        fireEvent.mouseDown(within(select).getByRole("combobox"));
        fireEvent.click(
            await screen.findByText(microcopy.members.roles.owner, {
                selector: ".ant-select-item-option-content"
            })
        );

        await waitFor(() =>
            expect(updateMemberRole).toHaveBeenCalledWith({
                userId: "user-bob",
                role: "owner"
            })
        );
    });

    it("removes a member behind a Popconfirm", async () => {
        removeMember.mockResolvedValue("Member removed");
        renderManager();

        fireEvent.click(
            within(rowFor("user-bob")).getByTestId("member-remove")
        );
        fireEvent.click(
            await screen.findByRole("button", {
                name: microcopy.members.remove
            })
        );

        await waitFor(() =>
            expect(removeMember).toHaveBeenCalledWith({ userId: "user-bob" })
        );
    });

    it("only offers directory users who aren't already on the roster", async () => {
        renderManager();
        const userSelect = screen.getByTestId("member-add-user");
        fireEvent.mouseDown(within(userSelect).getByRole("combobox"));

        // Carol + Dave are addable; the existing members are filtered out.
        expect(
            await screen.findByRole("option", { name: /carol/ })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("option", { name: /dave/ })
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("option", { name: /alice/ })
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("option", { name: /bob/ })
        ).not.toBeInTheDocument();
    });

    it("adds the selected user with the default viewer role and clears the picker", async () => {
        addMember.mockResolvedValue("Member added");
        renderManager();

        const userSelect = screen.getByTestId("member-add-user");
        fireEvent.mouseDown(within(userSelect).getByRole("combobox"));
        fireEvent.click(
            await screen.findByText(/carol/, {
                selector: ".ant-select-item-option-content"
            })
        );

        fireEvent.click(screen.getByTestId("member-add-submit"));

        await waitFor(() =>
            expect(addMember).toHaveBeenCalledWith({
                userId: "user-carol",
                role: "viewer"
            })
        );
    });

    it("shows a muted hint when there are no addable directory users", () => {
        // Directory contains only people already on the roster.
        setDirectory(
            directory.filter(
                (m) => m._id !== "user-carol" && m._id !== "user-dave"
            )
        );
        renderManager();
        expect(screen.getByTestId("members-no-addable")).toBeInTheDocument();
        expect(screen.queryByTestId("member-add-user")).not.toBeInTheDocument();
    });

    it("renders localized copy after switching to zh-CN", () => {
        setActiveLocale("zh-CN");
        renderManager();
        expect(
            within(rowFor(MANAGER_ID)).getByTestId("member-manager-badge")
        ).toHaveTextContent("负责人");
        // The manager row's role renders as a localized tag.
        expect(
            within(rowFor(MANAGER_ID)).getByTestId("member-role-tag")
        ).toHaveTextContent("所有者");
        expect(screen.getByTestId("member-add-submit")).toHaveTextContent(
            "添加成员"
        );
    });

    it("has no axe violations with a populated, manageable roster", async () => {
        const { container } = renderManager();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
