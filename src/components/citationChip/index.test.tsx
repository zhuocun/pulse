import { render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";

import type { CitationRef } from "../../interfaces/agent";
import CitationChip from ".";

describe("CitationChip", () => {
    it("labels backend user citations as User", () => {
        const citation: CitationRef = {
            source: "user",
            id: "u1",
            quote: "Alice created the task"
        };

        render(
            <AntdApp>
                <CitationChip citation={citation} index={1} />
            </AntdApp>
        );

        expect(
            screen.getByLabelText("Citation 1: User u1")
        ).toBeInTheDocument();
    });
});
