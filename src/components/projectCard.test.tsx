import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import ProjectCard from "./projectCard";

type DropdownMenuItem = {
    key?: string | number;
    label?: ReactNode;
    onClick?: () => void;
    danger?: boolean;
};

type DropdownMockProps = {
    children: ReactNode;
    menu?: {
        items?: DropdownMenuItem[];
    };
};

/**
 * Lightweight Dropdown mock. The real AntD Dropdown attaches menu
 * items as `role="menuitem"` elements that invoke their `onClick` on
 * both pointer and keyboard activation; this mock mirrors the
 * minimum surface area the tests need:
 *
 *  - Render the trigger (children) untouched.
 *  - Render each `items[]` entry as a `role="menuitem"` button so the
 *    tests can assert keyboard activation (Enter / Space on a
 *    menuitem fires the wired `onClick`, exactly what the production
 *    Dropdown does at the rc-menu layer).
 *  - Wire the per-item `onClick` to the menuitem's `click` handler
 *    rather than calling the production AntD `MenuInfo` callback —
 *    the production handler only needs to fire on activation.
 *
 * Lets the suite assert the QW-rewire contract: each menuitem is a
 * single AT-readable element (no nested `<button>` wrapper anymore)
 * with its own activation handler, and Enter on the menuitem invokes
 * the wired callback.
 */
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
                            "button",
                            {
                                key: item.key,
                                onClick: item.onClick,
                                role: "menuitem",
                                type: "button"
                            },
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

    // Each menu entry now renders as a single AT-readable element
    // (`role="menuitem"`) with no nested `<button>` wrapper. Clicking
    // the menuitem fires the wired `onClick` directly — no more
    // double-announce ("Edit · Edit roadmap") or stopPropagation
    // gymnastics inside the label.
    it("invokes onEdit from the row actions menu on click", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            within(dropdown).getByRole("menuitem", { name: /^edit$/i })
        );

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("invokes onDelete from the row actions menu on click", async () => {
        const user = userEvent.setup();
        const { onDelete } = renderCard();

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            within(dropdown).getByRole("menuitem", { name: /^delete$/i })
        );

        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    // Keyboard activation: tabbing to a menuitem and pressing Enter
    // must fire the wired handler. The new structure routes activation
    // through the menuitem directly (no inner button to swallow the
    // event), so Enter triggers `onEdit` without the previously needed
    // `e.stopPropagation()` workaround.
    it("invokes onEdit when Enter is pressed on the menuitem", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        const editItem = within(
            screen.getByTestId("project-card-actions-dropdown")
        ).getByRole("menuitem", { name: /^edit$/i });

        editItem.focus();
        await user.keyboard("{Enter}");

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, with AAA at 44×44. The card's row-action cluster
    // ("like" + "more actions") wraps AntD's inline `size="small"` icon
    // buttons, which collapse to ~24 px by default — below the AAA target.
    // The styled `ActionsCluster` lifts each `.ant-btn-sm` descendant to
    // `min-height: 44px` / `min-width: 44px` under `@media (pointer: coarse)`
    // so a thumb can land it. Walk the rendered stylesheet (same approach as
    // `src/layouts/authLayout.test.tsx` for `AuthButton`) and assert the 44 px
    // declaration is still emitted — a future style refactor that drops it
    // below 44 must fail CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderCard();
        // The styled `ActionsCluster` wraps both row-action buttons; grab it
        // via the like control and walk up the ancestor chain looking for
        // the nearest element that carries a bare `css-xxx` emotion class
        // (skipping AntD's `css-var-root` / `css-dev-only-...` markers,
        // which sit on every AntD descendant under its ConfigProvider).
        const likeButton = screen.getByRole("button", {
            name: /like roadmap/i
        });
        const isEmotionToken = (tok: string) =>
            /^css-[a-z0-9]{4,}$/i.test(tok) &&
            !tok.startsWith("css-var-") &&
            !tok.startsWith("css-dev-only-");
        let cluster: HTMLElement | null = likeButton;
        let styledCls: string | undefined;
        while (cluster) {
            styledCls = cluster.className
                ?.toString()
                .split(/\s+/)
                .find(isEmotionToken);
            if (styledCls) break;
            cluster = cluster.parentElement;
        }
        expect(styledCls).toBeTruthy();

        // Walk every stylesheet's rules — including nested rules inside
        // `@media (pointer: coarse)` where the touch-target lift lives —
        // and collect any `(min-)?height: <N>px` declaration on a rule
        // that mentions the styled class. The descendant selector
        // `.css-xxx .ant-btn-sm` keeps the same class token in the
        // selector text, so the same anchor works.
        const heights: number[] = [];
        const visit = (rule: CSSRule) => {
            if (rule instanceof CSSStyleRule) {
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    return;
                const re = /(?:^|[\s;{])(?:min-)?height:\s*(\d+(?:\.\d+)?)px/gi;
                let m: RegExpExecArray | null = re.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0"));
                    m = re.exec(rule.cssText);
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

        expect(heights).toContain(44);
    });

    it("keeps the project title as the primary link target", async () => {
        const user = userEvent.setup();
        renderCard();

        const link = screen.getByRole("link", { name: /^roadmap$/i });
        expect(link).toHaveAttribute("href", "/projects/project-1");

        await user.click(link);
    });
});
