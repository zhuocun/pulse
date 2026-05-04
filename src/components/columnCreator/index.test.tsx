import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
    });

    afterAll(() => {
        fetchMock.mockRestore();
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
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                body: JSON.stringify({
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

    it("does not submit a named column just because the input blurs", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Later" } });
        fireEvent.blur(input);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue("Later")).toBeInTheDocument();
    });
});
