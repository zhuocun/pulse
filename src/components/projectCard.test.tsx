import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import ProjectCard from "./projectCard";

type DropdownMockProps = {
    children: ReactNode;
    menu?: {
        items?: Array<{ key?: string | number; label?: ReactNode }>;
    };
};

jest.mock("antd", () => {
    const actual = jest.requireActual("antd");
    const React = jest.requireActual("react");

    return {
        ...actual,
        Dropdown: ({ children, menu }: DropdownMockProps) =>
            React.createElement(
                "div",
                { "data-testid": "project-card-actions-dropdown" },
                children,
                React.createElement(
                    "div",
                    { "data-testid": "dropdown-menu" },
                    menu?.items?.map((item) =>
                        React.createElement(
                            "div",
                            { key: item.key },
                            item.label
                        )
                    )
                )
            )
    };
});

const manager: IMember = {
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice"
};

const sampleProject: IProject = {
    _id: "project-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap"
};

describe("ProjectCard", () => {
    const renderCard = (
        props?: Partial<React.ComponentProps<typeof ProjectCard>>
    ) => {
        const onLike = jest.fn();
        const onEdit = jest.fn();
        const onDelete = jest.fn();
        const merged = {
            liked: false,
            manager,
            onDelete,
            onEdit,
            onLike,
            project: sampleProject,
            ...props
        };
        render(
            <MemoryRouter>
                <ProjectCard {...merged} />
            </MemoryRouter>
        );
        return { onDelete, onEdit, onLike };
    };

    it("invokes onLike when the heart control is clicked", async () => {
        const user = userEvent.setup();
        const { onLike } = renderCard();

        await user.click(screen.getByRole("button", { name: /like roadmap/i }));

        expect(onLike).toHaveBeenCalledTimes(1);
    });

    it("invokes onEdit from the row actions menu without navigating first", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            screen.getByRole("button", { name: /^edit roadmap$/i })
        );

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("invokes onDelete from the row actions menu", async () => {
        const user = userEvent.setup();
        const { onDelete } = renderCard();

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            screen.getByRole("button", { name: /^delete roadmap$/i })
        );

        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("keeps the project title as the primary link target", async () => {
        const user = userEvent.setup();
        renderCard();

        const link = screen.getByRole("link", { name: /^roadmap$/i });
        expect(link).toHaveAttribute("href", "/projects/project-1");

        await user.click(link);
    });
});
