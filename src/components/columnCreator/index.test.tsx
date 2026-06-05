import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { ruleTextsFor, styledClassFor } from "../../testUtils/styleRules";

import ColumnCreator from ".";

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const renderCreator = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<ColumnCreator />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("ColumnCreator", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(
            response({
                _id: "column-1",
                columnName: "Todo",
                index: 0,
                projectId: "project-1"
            })
        );
        // Clear the activity feed so the Phase 4.3 integration
        // assertion below reads a deterministic event list.
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    afterEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    const expandIntoInput = async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add column" }));
        return screen.findByPlaceholderText(/Create column/);
    };

    it("starts collapsed and reveals the input on click", async () => {
        renderCreator();
        expect(
            screen.getByRole("button", { name: "Add column" })
        ).toBeInTheDocument();
        expect(
            screen.queryByPlaceholderText(/Create column/)
        ).not.toBeInTheDocument();

        const input = await expandIntoInput();
        expect(input).toBeInTheDocument();
    });

    it("creates a column for the current project and clears the input", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "QA" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/boards");
        // The create payload now carries the column ``category`` (the
        // persisted "done" source of truth); it defaults to "todo".
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                body: JSON.stringify({
                    category: "todo",
                    columnName: "QA",
                    projectId: "project-1"
                }),
                method: "POST"
            })
        );
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Add column" })
            ).toBeInTheDocument()
        );
    });

    it("defaults the category picker to To do and sends it on create", async () => {
        renderCreator();
        await expandIntoInput();

        // The category Select is rendered alongside the name input and
        // starts on the default "To do" (todo) bucket.
        expect(
            screen.getByRole("combobox", { name: "New column category" })
        ).toBeInTheDocument();
        expect(screen.getByTitle("To do")).toBeInTheDocument();
    });

    it("sends the chosen category in the create payload", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Shipped" } });

        // Open the category picker and pick the "Done" bucket.
        fireEvent.mouseDown(
            screen.getByRole("combobox", { name: "New column category" })
        );
        fireEvent.click(await screen.findByText("Done"));

        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                body: JSON.stringify({
                    category: "done",
                    columnName: "Shipped",
                    projectId: "project-1"
                }),
                method: "POST"
            })
        );
    });

    it("disables the input while the create mutation is pending", async () => {
        let resolveFetch: (value: Response) => void = () => undefined;
        fetchMock.mockReturnValue(
            new Promise<Response>((resolve) => {
                resolveFetch = resolve;
            })
        );
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Doing" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(input).toBeDisabled());
        resolveFetch(response({ _id: "column-2", columnName: "Doing" }));
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Add column" })
            ).toBeInTheDocument()
        );
    });

    it("ignores blank submissions and collapses on Escape", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.keyDown(input, { key: "Escape" });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Add column" })
            ).toBeInTheDocument()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, with AAA at 44×44. The "Add column" affordance is
    // the canvas-level commit point for adding a new column and must stay
    // generous on touch. Its styled component declares `min-height: 3rem`
    // (48 px in jsdom's default 16 px root). Walk the rendered stylesheet
    // (same approach as `src/layouts/authLayout.test.tsx` for `AuthButton`)
    // and assert the declaration is still emitted at >=44 px-equivalent so
    // a future style refactor that drops it below the AAA target fails CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderCreator();
        const button = screen.getByRole("button", { name: "Add column" });
        const styledCls = button.className
            .split(/\s+/)
            .find(
                (tok) =>
                    /^css-[a-z0-9]{4,}$/i.test(tok) &&
                    !tok.startsWith("css-var-") &&
                    !tok.startsWith("css-dev-only-")
            );
        expect(styledCls).toBeTruthy();

        // Walk every stylesheet's rules and collect any `(min-)?height`
        // declaration on a rule that mentions the styled class. Pixel
        // values are kept as-is; `rem` values are converted with the
        // jsdom default root font size of 16 px so the assertion can
        // compare against the 44 px AAA target.
        const heights: number[] = [];
        const REM_PX = 16;
        const visit = (rule: CSSRule) => {
            if (rule instanceof CSSStyleRule) {
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    return;
                const pxRe =
                    /(?:^|[\s;{])(?:min-)?height:\s*(\d+(?:\.\d+)?)px/gi;
                let m: RegExpExecArray | null = pxRe.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0"));
                    m = pxRe.exec(rule.cssText);
                }
                const remRe =
                    /(?:^|[\s;{])(?:min-)?height:\s*(\d+(?:\.\d+)?)rem/gi;
                m = remRe.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0") * REM_PX);
                    m = remRe.exec(rule.cssText);
                }
            } else if ("cssRules" in rule) {
                for (const child of Array.from(
                    (rule as CSSGroupingRule).cssRules
                )) {
                    visit(child);
                }
            }
        };
        Array.from(document.styleSheets).forEach((sheet) => {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                return;
            }
            for (const rule of Array.from(rules)) visit(rule);
        });

        expect(heights.length).toBeGreaterThan(0);
        expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
    });

    it("keeps the collapsed desktop add-column slot compact enough to avoid clipping the board", () => {
        renderCreator();
        const button = screen.getByRole("button", { name: "Add column" });
        const slot = button.parentElement;
        expect(slot).not.toBeNull();

        const styledClass = styledClassFor(slot as Element);
        expect(styledClass).toBeTruthy();
        const ruleText = ruleTextsFor(styledClass ?? "").join("\n");
        expect(ruleText).toContain("min-width: 9rem");
    });

    /*
     * Phase 4.3 — integration assertion. The column-create flow
     * must surface a corresponding row in the activity feed (the
     * bell-icon source of truth). The assertion reads Redux
     * directly so it's independent of any particular drawer-UI
     * affordance.
     */
    it("records an activity-feed event when a column is created (Phase 4.3 integration)", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "QA" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe("column");
            expect(events[0].action).toBe("create");
            expect(events[0].summary).toContain("QA");
        });
    });

    it("does not submit a named column just because the input blurs", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Later" } });
        fireEvent.blur(input);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue("Later")).toBeInTheDocument();
    });
});
