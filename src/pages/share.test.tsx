import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { message } from "antd";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";

import SharePage from "./share";

jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;

const stubMutation = (mutateAsync: jest.Mock) =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync
    }) as unknown as ReturnType<typeof useReactMutation<unknown>>;

const stubQuery = <T,>(data: T | undefined, isLoading = false) =>
    ({
        data,
        error: null,
        isLoading,
        isSuccess: !isLoading,
        refetch: jest.fn()
    }) as unknown as ReturnType<typeof useReactQuery<T>>;

const projectsFixture: IProject[] = [
    {
        _id: "project-1",
        managerId: "member-1",
        organization: "Atlas",
        projectName: "Atlas roadmap"
    },
    {
        _id: "project-2",
        managerId: "member-2",
        organization: "Bravo",
        projectName: "Bravo launch"
    }
];

const columnsFixture: IColumn[] = [
    {
        _id: "column-1",
        columnName: "Backlog",
        index: 0,
        projectId: "project-1"
    },
    {
        _id: "column-2",
        columnName: "In progress",
        index: 1,
        projectId: "project-1"
    }
];

const userFixture: IUser = {
    _id: "user-1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice"
};

beforeAll(() => {
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
});

const LocationProbe = () => {
    const location = useLocation();
    return (
        <div data-testid="location">{location.pathname + location.search}</div>
    );
};

const renderShare = (initialEntry: string) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users"], userFixture);

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <Routes>
                        <Route path="/share" element={<SharePage />} />
                        <Route
                            path="/projects/:projectId/board"
                            element={<LocationProbe />}
                        />
                        <Route path="/projects" element={<LocationProbe />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("SharePage", () => {
    /**
     * `useReactQuery` is called twice in the page: first for the project
     * list (no params), then for the board columns (with a projectId).
     * We map by call args so the order of mock returns stays stable even
     * if React re-runs them in a different sequence under Strict mode.
     */
    const wireQueries = (overrides?: {
        projects?: IProject[];
        columns?: IColumn[];
        projectsLoading?: boolean;
    }) => {
        const projects = overrides?.projects ?? projectsFixture;
        const columns = overrides?.columns ?? columnsFixture;
        mockedUseReactQuery.mockImplementation(((
            endpoint: string,
            params?: { [key: string]: unknown }
        ) => {
            if (endpoint === "projects" && !params) {
                return stubQuery(projects, overrides?.projectsLoading) as never;
            }
            if (endpoint === "boards") {
                return stubQuery(columns) as never;
            }
            return stubQuery(undefined) as never;
        }) as unknown as typeof mockedUseReactQuery);
    };

    beforeEach(() => {
        mockedUseReactMutation.mockReset();
        mockedUseReactQuery.mockReset();
    });

    // Restore module-level mocks so subsequent test files start from a
    // clean slate — without this, useReactQuery / useReactMutation stayed
    // mocked across files and leaked into anything that imports them.
    afterAll(() => {
        jest.restoreAllMocks();
    });

    it("renders the shared title as the default task name and shows the shared text + url", () => {
        wireQueries();
        const mutateAsync = jest.fn();
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        renderShare(
            "/share?title=Pulse%20release%20notes&text=The%20latest%20build%20ships%20Web%20Share%20Target&url=https%3A%2F%2Fexample.com%2Frelease"
        );

        expect(
            screen.getByRole("heading", { name: microcopy.share.headline })
        ).toBeInTheDocument();
        expect(screen.getByLabelText(microcopy.fields.taskName)).toHaveValue(
            "Pulse release notes"
        );
        const summary = screen.getByTestId("share-summary");
        expect(summary).toHaveTextContent(
            "The latest build ships Web Share Target"
        );
        expect(summary).toHaveTextContent("https://example.com/release");
    });

    it("submits a task with the shared title + composed note when Create task is pressed", async () => {
        wireQueries();
        const mutateAsync = jest.fn().mockResolvedValue(undefined);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        renderShare(
            "/share?title=Ship%20it&text=A%20draft%20note&url=https%3A%2F%2Fexample.com%2Fa"
        );

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        expect(mutateAsync).toHaveBeenCalledWith({
            taskName: "Ship it",
            projectId: "project-1",
            columnId: "column-1",
            coordinatorId: "user-1",
            note: "A draft note\n\nhttps://example.com/a"
        });
        // After a successful submit we route to the picked project's board.
        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent(
                "/projects/project-1/board"
            )
        );
    });

    it("falls back to a slice of the shared text when no title is supplied", () => {
        wireQueries();
        mockedUseReactMutation.mockReturnValue(stubMutation(jest.fn()));

        renderShare("/share?text=A%20short%20snippet%20without%20a%20title");

        expect(screen.getByLabelText(microcopy.fields.taskName)).toHaveValue(
            "A short snippet without a title"
        );
    });

    /*
     * Android Chrome routinely packs the same URL into both `text`
     * (as the trailing portion of the shared snippet) AND `url`. The
     * dedup check is now a substring test, so the URL appears in the
     * note exactly once instead of being duplicated.
     */
    it("composes a single URL line even when the shared text already contains the URL (Android Chrome dedup)", async () => {
        wireQueries();
        const mutateAsync = jest.fn().mockResolvedValue(undefined);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        renderShare(
            "/share?text=Check%20this%20https%3A%2F%2Fexample.com%2Fx&url=https%3A%2F%2Fexample.com%2Fx"
        );

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        const call = mutateAsync.mock.calls[0]?.[0] as { note?: string };
        // The note must reproduce the text once; the URL must appear
        // exactly once (not appended as a second segment).
        expect(call.note).toBe("Check this https://example.com/x");
    });

    it("renders an empty-state CTA when the user has no projects", () => {
        wireQueries({ projects: [] });
        mockedUseReactMutation.mockReturnValue(stubMutation(jest.fn()));

        renderShare("/share?title=Anything");

        expect(
            screen.getByRole("heading", { name: microcopy.share.emptyTitle })
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.share.emptyDescription)
        ).toBeInTheDocument();
        // No form / submit affordance when there's nowhere to share into.
        expect(
            screen.queryByRole("button", { name: microcopy.actions.createTask })
        ).not.toBeInTheDocument();
    });

    it("renders the 'nothing to share' alert when no params are present, but still allows manual entry", () => {
        wireQueries();
        mockedUseReactMutation.mockReturnValue(stubMutation(jest.fn()));

        renderShare("/share");

        expect(screen.getByTestId("share-nothing")).toBeInTheDocument();
        // Task name input is rendered, but empty — so the submit is disabled.
        expect(screen.getByLabelText(microcopy.fields.taskName)).toHaveValue(
            ""
        );
        expect(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        ).toBeDisabled();
    });

    /*
     * Failure surfacing — without the onCreate try/catch the success
     * toast + navigate ran on rejection, silently dropping the user's
     * shared content. The contract is now: on rejection, show
     * feedback.saveFailed and leave the form intact (no navigate).
     */
    it("shows the saveFailed message and does not navigate when the mutation rejects", async () => {
        wireQueries();
        const error = new Error("network down");
        const mutateAsync = jest.fn().mockRejectedValue(error);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));
        const errorSpy = jest
            .spyOn(message, "error")
            .mockImplementation(() => "" as never);
        const successSpy = jest
            .spyOn(message, "success")
            .mockImplementation(() => "" as never);

        renderShare("/share?title=Ship%20it");

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(errorSpy).toHaveBeenCalledWith(microcopy.feedback.saveFailed)
        );
        expect(successSpy).not.toHaveBeenCalled();
        // Stays on /share — no nav fired.
        expect(screen.queryByTestId("location")).not.toBeInTheDocument();

        errorSpy.mockRestore();
        successSpy.mockRestore();
    });

    /*
     * Security — a `javascript:` URL doesn't XSS through React's text-
     * escaping but the literal would still be rendered to the user.
     * `isSafeShareUrl` filters non-http(s) schemes everywhere: the
     * summary card, the composed note, and the derived task name.
     */
    it("does not render a javascript: URL in the summary card", () => {
        wireQueries();
        mockedUseReactMutation.mockReturnValue(stubMutation(jest.fn()));

        renderShare(
            "/share?title=Pretend&url=javascript%3Aalert(1)&text=harmless"
        );

        const summary = screen.getByTestId("share-summary");
        // The URL row is suppressed entirely (no anchor or text).
        expect(summary).not.toHaveTextContent("javascript:alert(1)");
        expect(summary).not.toHaveTextContent(microcopy.share.summaryUrl);
        expect(summary).toHaveTextContent("harmless");
    });

    it("does not render a data: URL in the summary card", () => {
        wireQueries();
        mockedUseReactMutation.mockReturnValue(stubMutation(jest.fn()));

        renderShare(
            "/share?title=Pretend&url=data%3Atext%2Fhtml%2C%3Cscript%3Ealert(1)%3C%2Fscript%3E"
        );

        const summary = screen.getByTestId("share-summary");
        expect(summary).not.toHaveTextContent("data:text/html");
        expect(summary).not.toHaveTextContent("script");
        expect(summary).not.toHaveTextContent(microcopy.share.summaryUrl);
    });

    it("excludes a javascript: URL from the composed note when submitting", async () => {
        wireQueries();
        const mutateAsync = jest.fn().mockResolvedValue(undefined);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        renderShare(
            "/share?title=Title&text=A%20note&url=javascript%3Aalert(1)"
        );

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        const call = mutateAsync.mock.calls[0]?.[0] as { note?: string };
        // Only the text is preserved; the unsafe URL is dropped entirely.
        expect(call.note).toBe("A note");
    });

    /*
     * Android Chrome's case + trailing-slash mismatch — the substring
     * dedup failed and the URL appeared twice. Normalise both sides
     * before comparing so a single canonical form collapses them.
     */
    it("dedups the URL when text and url differ only by case", async () => {
        wireQueries();
        const mutateAsync = jest.fn().mockResolvedValue(undefined);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        renderShare(
            "/share?text=Look%3A%20https%3A%2F%2FExample.com%2Fx&url=https%3A%2F%2Fexample.com%2Fx"
        );

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        const call = mutateAsync.mock.calls[0]?.[0] as { note?: string };
        // The URL is recognised as already present in the text despite
        // the case mismatch and is NOT appended a second time.
        expect(call.note).toBe("Look: https://Example.com/x");
    });

    it("dedups the URL when only the trailing slash differs", async () => {
        wireQueries();
        const mutateAsync = jest.fn().mockResolvedValue(undefined);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        renderShare(
            "/share?text=See%20https%3A%2F%2Fexample.com%2Fx&url=https%3A%2F%2Fexample.com%2Fx%2F"
        );

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        const call = mutateAsync.mock.calls[0]?.[0] as { note?: string };
        expect(call.note).toBe("See https://example.com/x");
    });

    it("preserves the query string when normalising for dedup", async () => {
        wireQueries();
        const mutateAsync = jest.fn().mockResolvedValue(undefined);
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));

        // text references the URL with `?utm=1`; the shared url ALSO
        // carries the query — the two should still dedup as the same
        // canonical form.
        renderShare(
            "/share?text=Read%20https%3A%2F%2Fexample.com%2Fx%3Futm%3D1&url=https%3A%2F%2Fexample.com%2Fx%3Futm%3D1"
        );

        fireEvent.click(
            screen.getByRole("button", { name: microcopy.actions.createTask })
        );

        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
        const call = mutateAsync.mock.calls[0]?.[0] as { note?: string };
        expect(call.note).toBe("Read https://example.com/x?utm=1");
    });
});
