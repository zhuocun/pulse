import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../constants/microcopy";

import InboxPage from "./inbox";

describe("InboxPage", () => {
    it("renders the inbox heading and the empty-state copy", () => {
        render(
            <BrowserRouter>
                <InboxPage />
            </BrowserRouter>
        );

        expect(
            screen.getByRole("heading", {
                level: 1,
                name: microcopy.inbox.heading
            })
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.inbox.emptyTitle)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.inbox.emptyDescription)
        ).toBeInTheDocument();
        expect(screen.getByTestId("inbox-empty-state")).toBeInTheDocument();
    });

    it("sets the document title to '{page} · Pulse'", () => {
        render(
            <BrowserRouter>
                <InboxPage />
            </BrowserRouter>
        );
        expect(document.title).toBe(`${microcopy.pageTitle.inbox} · Pulse`);
    });
});
