import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import useReactQuery from "../../utils/hooks/useReactQuery";

import MemberPopover from ".";

jest.mock("../../utils/hooks/useReactQuery");

const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
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

    mockedUseReactQuery.mockReturnValue({
        data: members,
        refetch
    } as unknown as ReturnType<typeof useReactQuery<IMember[]>>);

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

    it("fetches members and shows their names when opened", async () => {
        const { refetch } = renderMemberPopover([
            member(),
            member({
                _id: "u2",
                email: "bob@example.com",
                username: "Bob"
            })
        ]);

        fireEvent.mouseEnter(screen.getByText("Members"));

        expect(await screen.findByText("Team members")).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
        await waitFor(() => {
            expect(refetch).toHaveBeenCalledTimes(1);
        });
    });

    it("renders an empty members list without failing", async () => {
        renderMemberPopover([]);

        fireEvent.mouseEnter(screen.getByText("Members"));

        expect(await screen.findByText("Team members")).toBeInTheDocument();
        expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
});
