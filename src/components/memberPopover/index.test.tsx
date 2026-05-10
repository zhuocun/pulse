import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
        installAntdBrowserMocks();
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

        expect(within(trigger).getByText("2")).toBeInTheDocument();
        expect(within(trigger).getByText("A")).toBeInTheDocument();
        expect(within(trigger).getByText("B")).toBeInTheDocument();

        fireEvent.mouseEnter(trigger);

        expect(await screen.findByText("Team Members")).toBeInTheDocument();
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

        fireEvent.mouseEnter(trigger);

        expect(await screen.findByText("Team Members")).toBeInTheDocument();
        expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
});
