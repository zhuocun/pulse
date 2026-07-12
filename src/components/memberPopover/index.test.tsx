import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import useMembersList from "../../utils/hooks/useMembersList";

import MemberPopover from ".";

jest.mock("../../utils/hooks/useMembersList");

const mockedUseMembersList = useMembersList as jest.MockedFunction<
    typeof useMembersList
>;

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const installBrowserMocks = () => {
    // Radix Popover drives its surface with pointer-capture APIs jsdom
    // doesn't ship; polyfill them so the members list can open.
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
};

const renderMemberPopover = (members: IMember[] = [member()]) => {
    const refetch = jest.fn();

    mockedUseMembersList.mockReturnValue({
        data: members,
        refetch
    } as unknown as ReturnType<typeof useMembersList>);

    render(<MemberPopover />);

    return { refetch };
};

describe("MemberPopover", () => {
    beforeAll(() => {
        installBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders member avatars and count without refetching when opened", async () => {
        const { refetch } = renderMemberPopover([
            member(),
            member({
                _id: "u2",
                email: "bob@example.com",
                username: "Bob"
            })
        ]);
        const trigger = screen.getByRole("button", {
            name: "View team members"
        });

        expect(trigger).toHaveClass("focus-visible:ring-2");
        expect(trigger).toHaveClass("focus-visible:ring-ring");
        expect(trigger).toHaveClass("focus-visible:ring-offset-2");
        expect(within(trigger).getByText("2")).toBeInTheDocument();
        expect(within(trigger).getByText("A")).toBeInTheDocument();
        expect(within(trigger).getByText("B")).toBeInTheDocument();

        await userEvent.setup().click(trigger);

        expect(await screen.findByText("Team members")).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
        await waitFor(() => {
            expect(refetch).not.toHaveBeenCalled();
        });
    });

    it("renders an empty members list without failing", async () => {
        renderMemberPopover([]);

        const trigger = screen.getByRole("button", {
            name: "View team members"
        });
        expect(within(trigger).getByText("0")).toBeInTheDocument();

        await userEvent.setup().click(trigger);

        expect(await screen.findByText("Team members")).toBeInTheDocument();
        expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
});
