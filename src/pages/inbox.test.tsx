import { act, render, screen, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import { activityFeedActions } from "../store/reducers/activityFeedSlice";
import { __resetActivityFeedUndoCallbacksForTests } from "../utils/hooks/useActivityFeed";
import useNotifications from "../utils/hooks/useNotifications";

import InboxPage from "./inbox";

expect.extend(toHaveNoViolations);

/*
 * The Inbox's Mentions section reads server notifications through
 * `useNotifications`, which hits React Query / the api layer. The page
 * suite renders the real `InboxPage` without a `QueryClientProvider`, so
 * we mock the hook and drive its `notifications` payload directly — the
 * hook's own fetch / mark-read behaviour is covered by
 * `useNotifications.test.tsx`. Default: no notifications (so the existing
 * activity-only cases see an empty Mentions section).
 */
jest.mock("../utils/hooks/useNotifications");

const mockedUseNotifications = useNotifications as jest.MockedFunction<
    typeof useNotifications
>;

const setNotifications = (notifications: INotification[] | undefined) => {
    mockedUseNotifications.mockReturnValue({
        notifications,
        unreadCount: (notifications ?? []).filter((n) => !n.isRead).length,
        isLoading: false,
        markRead: jest.fn(),
        markAllRead: jest.fn(),
        isMutating: false
    });
};

const buildMention = (
    overrides: Partial<INotification> = {}
): INotification => ({
    _id: "ntf-1",
    userId: "u-1",
    kind: "mention",
    refId: "task-1",
    projectId: "proj-1",
    summary: "Alice mentioned you in “Ship inbox”",
    isRead: false,
    createdAt: new Date().toISOString(),
    ...overrides
});

/*
 * Canonical AntD browser mocks. The grouped `SettingsSection` chrome
 * pulls in `useReducedMotion` (which reads `window.matchMedia`); jsdom
 * doesn't implement it, so we install the project-standard stub.
 */
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

const renderPage = () =>
    render(
        <Provider store={store}>
            <BrowserRouter>
                <InboxPage />
            </BrowserRouter>
        </Provider>
    );

/*
 * Seed activity events the same way the activity-drawer suite does:
 * dispatch `recordActivityEvent` straight into the shared production
 * store (the serializable Redux shape) wrapped in `act`. The page's
 * `useActivityFeed` reads back through the same store, so a render after
 * seeding sees the rows.
 */
const seedEvent = (overrides: {
    id: string;
    summary: string;
    kind?: "task" | "column" | "project" | "ai";
    timestamp?: number;
}) => {
    act(() => {
        store.dispatch(
            activityFeedActions.recordActivityEvent({
                id: overrides.id,
                timestamp: overrides.timestamp ?? Date.now(),
                kind: overrides.kind ?? "task",
                action: "create",
                summary: overrides.summary,
                undoable: false,
                isRead: false
            })
        );
    });
};

describe("InboxPage", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        // Default: no server notifications. Individual cases override via
        // `setNotifications` before rendering.
        setNotifications([]);
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
        __resetActivityFeedUndoCallbacksForTests();
    });

    afterEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
        __resetActivityFeedUndoCallbacksForTests();
    });

    it("renders the inbox heading", () => {
        renderPage();
        expect(
            screen.getByRole("heading", {
                level: 1,
                name: microcopy.inbox.heading
            })
        ).toBeInTheDocument();
    });

    it("sets the document title to '{page} · Pulse'", () => {
        renderPage();
        expect(document.title).toBe(`${microcopy.pageTitle.inbox} · Pulse`);
    });

    describe("with an empty activity feed", () => {
        it("renders the page-level empty state and no grouped sections", () => {
            renderPage();

            expect(screen.getByTestId("inbox-empty-state")).toBeInTheDocument();
            expect(
                screen.getByText(microcopy.inbox.emptyTitle)
            ).toBeInTheDocument();
            expect(
                screen.getByText(microcopy.inbox.emptyDescription)
            ).toBeInTheDocument();

            // The grouped sections only appear once Activity has data.
            expect(
                screen.queryByTestId("inbox-section-activity")
            ).not.toBeInTheDocument();
            expect(
                screen.queryByTestId("inbox-section-triage")
            ).not.toBeInTheDocument();
            expect(
                screen.queryByTestId("inbox-section-mentions")
            ).not.toBeInTheDocument();
        });

        it("has no axe violations", async () => {
            const { container } = renderPage();
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });

    describe("with seeded activity events", () => {
        it("renders the Activity section with the event summaries", () => {
            seedEvent({ id: "evt-1", summary: "Created task “Ship inbox”" });
            seedEvent({
                id: "evt-2",
                kind: "ai",
                summary: "AI grouped 3 tasks"
            });
            renderPage();

            const activity = screen.getByTestId("inbox-section-activity");
            expect(activity).toBeInTheDocument();
            expect(
                within(activity).getByText("Created task “Ship inbox”")
            ).toBeInTheDocument();
            expect(
                within(activity).getByText("AI grouped 3 tasks")
            ).toBeInTheDocument();
            expect(
                within(activity).getAllByTestId("inbox-activity-row")
            ).toHaveLength(2);

            // The page-level empty state is replaced by the sections.
            expect(
                screen.queryByTestId("inbox-empty-state")
            ).not.toBeInTheDocument();
        });

        it("shows the Triage and Mentions structural empty copy", () => {
            seedEvent({ id: "evt-1", summary: "Updated task “Triage me”" });
            renderPage();

            const triage = screen.getByTestId("inbox-section-triage");
            const mentions = screen.getByTestId("inbox-section-mentions");
            expect(
                within(triage).getByText(microcopy.inbox.sections.triage.empty)
            ).toBeInTheDocument();
            expect(
                within(mentions).getByText(
                    microcopy.inbox.sections.mentions.empty
                )
            ).toBeInTheDocument();
        });

        it("orders activity rows newest-first", () => {
            const now = Date.now();
            seedEvent({
                id: "evt-old",
                summary: "Older event",
                timestamp: now - 60_000
            });
            seedEvent({
                id: "evt-new",
                summary: "Newer event",
                timestamp: now
            });
            renderPage();

            const rows = screen.getAllByTestId("inbox-activity-row");
            expect(rows[0]).toHaveAttribute("data-event-id", "evt-new");
            expect(rows[1]).toHaveAttribute("data-event-id", "evt-old");
        });

        it("marks the seeded events read when the page is viewed", () => {
            seedEvent({ id: "evt-1", summary: "Unread on arrival" });
            expect(
                store
                    .getState()
                    .activityFeed.events.find((e) => e.id === "evt-1")?.isRead
            ).toBe(false);

            renderPage();

            expect(
                store
                    .getState()
                    .activityFeed.events.find((e) => e.id === "evt-1")?.isRead
            ).toBe(true);
        });

        it("has no axe violations", async () => {
            seedEvent({ id: "evt-1", summary: "Created task “A11y check”" });
            const { container } = renderPage();
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });

    describe("Mentions section (server notifications)", () => {
        it("renders the grouped sections when only mentions exist (no activity)", () => {
            setNotifications([buildMention()]);
            renderPage();

            // Mentions data alone lifts the page out of the all-empty
            // page-level fallback into the grouped three-section layout.
            expect(
                screen.queryByTestId("inbox-empty-state")
            ).not.toBeInTheDocument();
            expect(
                screen.getByTestId("inbox-section-mentions")
            ).toBeInTheDocument();
        });

        it("renders each mention's summary inside the Mentions section", () => {
            setNotifications([
                buildMention({
                    _id: "ntf-1",
                    summary: "Alice mentioned you in “Ship inbox”"
                }),
                buildMention({
                    _id: "ntf-2",
                    refId: "task-2",
                    summary: "Bob mentioned you in “Fix bug”"
                })
            ]);
            renderPage();

            const mentions = screen.getByTestId("inbox-section-mentions");
            expect(
                within(mentions).getByText(
                    "Alice mentioned you in “Ship inbox”"
                )
            ).toBeInTheDocument();
            expect(
                within(mentions).getByText("Bob mentioned you in “Fix bug”")
            ).toBeInTheDocument();
            expect(
                within(mentions).getAllByTestId("inbox-mention-row")
            ).toHaveLength(2);
        });

        it("links a mention with a projectId to that project's board", () => {
            setNotifications([
                buildMention({ projectId: "proj-42", refId: "task-7" })
            ]);
            renderPage();

            const row = screen.getByTestId("inbox-mention-row");
            // Router <Link> renders an <a href>; the affordance points at
            // the (always-valid) project board where the task lives.
            expect(row.tagName).toBe("A");
            expect(row).toHaveAttribute("href", "/projects/proj-42/board");
            expect(row).toHaveAttribute("data-ref-id", "task-7");
        });

        it("renders a non-linked mention row when projectId is absent", () => {
            setNotifications([
                buildMention({
                    projectId: undefined,
                    summary: "No project ref"
                })
            ]);
            renderPage();

            const row = screen.getByTestId("inbox-mention-row");
            expect(row.tagName).not.toBe("A");
            expect(within(row).getByText("No project ref")).toBeInTheDocument();
        });

        it("ignores non-mention notification kinds", () => {
            setNotifications([
                buildMention({ _id: "m-1", summary: "A real mention" }),
                buildMention({
                    _id: "x-1",
                    kind: "assignment",
                    summary: "Not a mention"
                })
            ]);
            renderPage();

            const mentions = screen.getByTestId("inbox-section-mentions");
            expect(
                within(mentions).getAllByTestId("inbox-mention-row")
            ).toHaveLength(1);
            expect(
                within(mentions).getByText("A real mention")
            ).toBeInTheDocument();
            expect(
                within(mentions).queryByText("Not a mention")
            ).not.toBeInTheDocument();
        });

        it("keeps the Mentions empty copy when activity exists but no mentions", () => {
            seedEvent({ id: "evt-1", summary: "Some activity" });
            setNotifications([]);
            renderPage();

            const mentions = screen.getByTestId("inbox-section-mentions");
            expect(
                within(mentions).getByText(
                    microcopy.inbox.sections.mentions.empty
                )
            ).toBeInTheDocument();
            expect(
                within(mentions).queryByTestId("inbox-mention-row")
            ).not.toBeInTheDocument();
        });

        it("has no axe violations with mentions rendered", async () => {
            setNotifications([
                buildMention({ _id: "ntf-1" }),
                buildMention({
                    _id: "ntf-2",
                    projectId: undefined,
                    summary: "Projectless mention"
                })
            ]);
            const { container } = renderPage();
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });
});
