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
import useLabels from "../../utils/hooks/useLabels";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";

import LabelsManager from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useLabels");
jest.mock("../../utils/hooks/useProjectMembers");
jest.mock("../../utils/hooks/useReactQuery");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseLabels = useLabels as jest.MockedFunction<typeof useLabels>;
const mockedUseProjectMembers = useProjectMembers as jest.MockedFunction<
    typeof useProjectMembers
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;

const installBrowserMocks = () => {
    // Radix Popover drives its surface with pointer-capture APIs jsdom
    // doesn't ship; polyfill them so the delete-confirm popover can open.
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
};

const createLabel = jest.fn();
const updateLabel = jest.fn();
const removeLabel = jest.fn();

const MANAGER_ID = "user-mike";

const labels: ILabel[] = [
    {
        _id: "label-1",
        projectId: "project-1",
        name: "Backend",
        color: "#3b82f6"
    },
    { _id: "label-2", projectId: "project-1", name: "Frontend", color: "blue" }
];

const roster: IProjectMember[] = [
    { _id: MANAGER_ID, username: "mike", email: "mike@x.io", role: "owner" },
    { _id: "user-ed", username: "ed", email: "ed@x.io", role: "editor" },
    { _id: "user-vi", username: "vi", email: "vi@x.io", role: "viewer" }
];

const setLabels = (overrides: Partial<ReturnType<typeof useLabels>> = {}) => {
    mockedUseLabels.mockReturnValue({
        labels,
        isLoading: false,
        createLabel,
        isCreating: false,
        updateLabel,
        isUpdating: false,
        removeLabel,
        isRemoving: false,
        ...overrides
    } as unknown as ReturnType<typeof useLabels>);
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

const renderManager = () => render(<LabelsManager projectId="project-1" />);

const rowFor = (labelId: string): HTMLElement => {
    const rows = screen.getAllByTestId("label-row");
    const row = rows.find(
        (candidate) => candidate.getAttribute("data-label-id") === labelId
    );
    if (!row) throw new Error(`No row for ${labelId}`);
    return row;
};

describe("LabelsManager", () => {
    beforeAll(installBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        setLabels();
        setRoster();
        setProject();
        setUser("user-ed"); // editor → can manage
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("renders a loading skeleton before the list resolves", () => {
        setLabels({ isLoading: true, labels: undefined });
        renderManager();
        expect(screen.getByTestId("labels-loading")).toBeInTheDocument();
    });

    it("renders an empty hint when there are no labels", () => {
        setLabels({ labels: [] });
        renderManager();
        expect(screen.getByTestId("labels-empty")).toBeInTheDocument();
        expect(screen.queryByTestId("label-row")).not.toBeInTheDocument();
    });

    it("renders a chip per label with its name", () => {
        renderManager();
        expect(screen.getByTestId("labels-manager")).toBeInTheDocument();
        const rows = screen.getAllByTestId("label-row");
        expect(rows).toHaveLength(2);
        expect(
            within(rowFor("label-1")).getByText("Backend")
        ).toBeInTheDocument();
        expect(
            within(rowFor("label-2")).getByText("Frontend")
        ).toBeInTheDocument();
    });

    it("creates a label with the trimmed name + selected colour", async () => {
        createLabel.mockResolvedValue("Label created");
        renderManager();

        fireEvent.change(screen.getByTestId("label-add-name"), {
            target: { value: "  Infra  " }
        });
        // Pick a non-default swatch from the add palette.
        const palette = screen.getByTestId("label-add-color");
        fireEvent.click(
            within(palette).getByRole("radio", {
                name: microcopy.projectLabels.colorSwatchAriaLabel.replace(
                    "{color}",
                    "#ef4444"
                )
            })
        );
        fireEvent.click(screen.getByTestId("label-add-submit"));

        await waitFor(() =>
            expect(createLabel).toHaveBeenCalledWith({
                name: "Infra",
                color: "#ef4444"
            })
        );
    });

    it("does not create when the name is blank", () => {
        renderManager();
        expect(screen.getByTestId("label-add-submit")).toBeDisabled();
        fireEvent.click(screen.getByTestId("label-add-submit"));
        expect(createLabel).not.toHaveBeenCalled();
    });

    it("renames a label through the inline editor (PUT with new name + colour)", async () => {
        updateLabel.mockResolvedValue("Label updated");
        renderManager();

        fireEvent.click(within(rowFor("label-1")).getByTestId("label-edit"));
        const nameInput = within(rowFor("label-1")).getByTestId(
            "label-edit-name"
        );
        fireEvent.change(nameInput, { target: { value: "API" } });
        fireEvent.click(
            within(rowFor("label-1")).getByTestId("label-edit-save")
        );

        await waitFor(() =>
            expect(updateLabel).toHaveBeenCalledWith({
                _id: "label-1",
                name: "API",
                color: "#3b82f6"
            })
        );
    });

    it("re-colours a label through the inline editor palette", async () => {
        updateLabel.mockResolvedValue("Label updated");
        renderManager();

        fireEvent.click(within(rowFor("label-1")).getByTestId("label-edit"));
        const palette = within(rowFor("label-1")).getByTestId(
            "label-edit-color"
        );
        fireEvent.click(
            within(palette).getByRole("radio", {
                name: microcopy.projectLabels.colorSwatchAriaLabel.replace(
                    "{color}",
                    "#22c55e"
                )
            })
        );
        fireEvent.click(
            within(rowFor("label-1")).getByTestId("label-edit-save")
        );

        await waitFor(() =>
            expect(updateLabel).toHaveBeenCalledWith(
                expect.objectContaining({ _id: "label-1", color: "#22c55e" })
            )
        );
    });

    it("deletes a label behind a Popconfirm (server cascade-strips tasks)", async () => {
        removeLabel.mockResolvedValue("Label deleted");
        renderManager();

        fireEvent.click(within(rowFor("label-1")).getByTestId("label-delete"));
        fireEvent.click(
            await screen.findByRole("button", {
                name: microcopy.projectLabels.delete
            })
        );

        await waitFor(() =>
            expect(removeLabel).toHaveBeenCalledWith("label-1")
        );
    });

    it("renders the list read-only for a viewer (no write controls)", () => {
        setUser("user-vi"); // viewer → cannot manage
        renderManager();
        expect(screen.getAllByTestId("label-row")).toHaveLength(2);
        expect(screen.getByTestId("labels-read-only-hint")).toBeInTheDocument();
        expect(screen.queryByTestId("label-edit")).not.toBeInTheDocument();
        expect(screen.queryByTestId("label-delete")).not.toBeInTheDocument();
        expect(screen.queryByTestId("label-add-name")).not.toBeInTheDocument();
    });

    it("stays read-only until the project query resolves (manager id unknown)", () => {
        mockedUseReactQuery.mockReturnValue({
            data: undefined
        } as unknown as ReturnType<typeof useReactQuery>);
        setUser("user-ed"); // editor per roster role
        renderManager();
        expect(screen.queryByTestId("label-add-name")).not.toBeInTheDocument();
        expect(screen.queryByTestId("label-edit")).not.toBeInTheDocument();
    });

    it("treats the project manager as a manager who can write", () => {
        setUser(MANAGER_ID);
        renderManager();
        expect(screen.getByTestId("label-add-name")).toBeInTheDocument();
        expect(
            within(rowFor("label-1")).getByTestId("label-edit")
        ).toBeInTheDocument();
    });

    it("renders localized copy after switching to zh-CN", () => {
        setActiveLocale("zh-CN");
        renderManager();
        expect(screen.getByTestId("label-add-submit")).toHaveTextContent(
            "添加标签"
        );
    });

    it("has no axe violations with a populated, manageable list", async () => {
        const { container } = renderManager();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
