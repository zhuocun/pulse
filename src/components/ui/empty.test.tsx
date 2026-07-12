import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Empty } from "./empty";

expect.extend(toHaveNoViolations);

describe("Empty", () => {
    it("renders title, description, and action", () => {
        render(
            <Empty
                title="No tasks yet"
                description="Create your first task"
                action={<button type="button">Create task</button>}
            />
        );
        expect(screen.getByText("No tasks yet")).toBeInTheDocument();
        expect(screen.getByText("Create your first task")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Create task" })
        ).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <Empty title="No tasks yet" description="Create your first task" />
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
