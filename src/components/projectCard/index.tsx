import {
    HeartFilled,
    HeartOutlined,
    MoreOutlined,
    TeamOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Dropdown, MenuProps, Skeleton } from "antd";
import React from "react";

import nativeNavigate from "../../utils/nativeNavigate";

import { microcopy } from "../../constants/microcopy";
import { getActiveLocaleCode } from "../../i18n";
import {
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    radius,
    semantic,
    shadow,
    space
} from "../../theme/tokens";
import { getAiSearchStrength } from "../../utils/ai/aiSearchStrength";
import AiMatchStrengthBadge from "../aiMatchStrengthBadge";
import UserAvatar from "../userAvatar";

interface ProjectCardProps {
    project: IProject;
    manager?: IMember;
    liked: boolean;
    onLike: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

const Card = styled.article`
    background: var(--ant-color-bg-container, #fff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.05));
    border-radius: ${radius.lg}px;
    box-shadow: ${shadow.xs};
    display: flex;
    flex-direction: column;
    isolation: isolate;
    overflow: hidden;
    position: relative;
    transition:
        border-color 180ms ease-out,
        box-shadow 180ms ease-out,
        transform 180ms ease-out;

    &:hover,
    &:focus-within {
        border-color: var(--glass-border-strong);
        box-shadow:
            ${shadow.md},
            0 0 0 1px var(--glass-border-strong),
            0 12px 32px -16px rgba(15, 23, 42, 0.18);
        transform: translateY(-2px);
    }

    /* Disable the lift on touch devices where hover feels janky. */
    @media (hover: none) {
        &:hover,
        &:focus-within {
            box-shadow: ${shadow.xs};
            transform: none;
        }
    }
`;

/*
 * Card body packs the whole project card into a single padded surface —
 * we no longer ship a separate `<Footer>` with its own border-top and
 * inset padding (which was responsible for ~30 px of dead vertical
 * chrome between the header and the manager row). Padding drops from
 * 24 px to 16 px and the gap between the title block and the meta row
 * tightens to ${space.sm}, so a sparse card (1-line title + manager +
 * date) clocks in around 100 px instead of the previous ~190 px.
 */
const Body = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: ${space.sm}px;
    padding: ${space.md}px;
    position: relative;
    z-index: 0;
`;

/**
 * Header row that anchors the card: a small project monogram avatar
 * inline with the title stack. The avatar drops from 44 px to 40 px so
 * the row sits at a calmer height and stops dictating the card's
 * minimum vertical rhythm.
 */
const HeaderRow = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.sm}px;
    min-width: 0;
    z-index: 2;
`;

const TitleStack = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

/*
 * Native `<a>` with an `onClick` that triggers a real browser
 * navigation via `window.location.assign(...)`. React Router's
 * `<Link>` and `useNavigate()` both updated the URL through
 * `history.pushState` without the `Routes` element re-rendering to
 * match on iOS Safari WebKit — same context-propagation failure
 * that broke overlay binding before we moved overlays off URL
 * state. A full document navigation bypasses Router entirely:
 * the browser fetches `index.html`, the app mounts fresh, and
 * React Router reads the URL on the first render. Slower than SPA
 * navigation, but the user actually gets to the board. The native
 * `href` is left in place so Cmd/Ctrl/Shift/middle-click open the
 * project in a new tab through the browser without going through
 * the imperative path at all.
 */
const TitleLink = styled.a`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    font-size: ${fontSize.lg}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: ${letterSpacing.tight};
    line-height: ${lineHeight.snug};
    overflow: hidden;
    overflow-wrap: break-word;
    text-decoration: none;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    display: -webkit-box;

    /*
     * Stretch the underlying anchor so anywhere on the card body that
     * isn't another interactive control routes to the project. This is
     * the "card-as-link" pattern: keyboard / screen-reader users tab to
     * the title text, sighted users can click the empty space.
     */
    &::after {
        bottom: 0;
        content: "";
        left: 0;
        position: absolute;
        right: 0;
        top: 0;
        z-index: 1;
    }

    &:hover,
    &:focus-visible {
        color: var(--ant-color-primary, #ea580c);
    }
`;

const Organization = styled.span`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    letter-spacing: ${letterSpacing.normal};
`;

/*
 * MetaRow consolidates manager identity + date + match-strength badge
 * + action buttons into a single compact row pinned to the bottom of
 * the body. Previously these split across a `ManagerRow` (with its own
 * 12 px padding-top) and a `<Footer>` (with a hairline divider plus
 * 8 px / 24 px insets), which pushed cards to ~190 px even with a
 * single-word title. `margin-top: auto` keeps the row anchored to the
 * bottom on cards that have grown tall (e.g. a 2-line title in the
 * same grid row), while shorter cards collapse cleanly.
 */
const MetaRow = styled.div`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    display: flex;
    flex-wrap: wrap;
    font-size: ${fontSize.sm}px;
    gap: ${space.xs}px;
    justify-content: space-between;
    margin-top: auto;
    min-width: 0;
    position: relative;
    z-index: 2;
`;

const Identity = styled.span`
    align-items: center;
    color: inherit;
    display: inline-flex;
    flex: 1 1 auto;
    gap: ${space.xs}px;
    min-width: 0;
    overflow: hidden;

    > .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`;

const MetaSeparator = styled.span`
    color: var(--ant-color-text-quaternary, rgba(15, 23, 42, 0.3));
    flex: 0 0 auto;
`;

const DateChip = styled.span`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
    flex: 0 0 auto;
    font-size: ${fontSize.xs}px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
`;

const ActionsCluster = styled.div`
    align-items: center;
    display: inline-flex;
    flex: 0 0 auto;
    gap: 2px;
    isolation: isolate;
    position: relative;
    z-index: 3;

    /*
     * On touch devices, AntD's small icon buttons collapse to ~24 px, which
     * is below the WCAG 2.5.5 AA recommendation of 44 x 44. Lift each
     * action target so a thumb can land it without zoom; the icon glyph
     * itself stays compact, only the click region grows.
     */
    @media (pointer: coarse) {
        .ant-btn-sm {
            min-height: 44px;
            min-width: 44px;
        }
    }
`;

const formatDate = (raw?: string): string => {
    if (!raw) return microcopy.feedback.noDate;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return microcopy.feedback.noDate;
    return new Intl.DateTimeFormat(getActiveLocaleCode(), {
        year: "numeric",
        month: "short",
        day: "2-digit"
    }).format(date);
};

/**
 * Single project card used inside the project list grid.
 *
 * Layout is two stacked rows inside one padded surface: a header row
 * with a small per-project monogram avatar inline with the title stack
 * (organisation + project name), and a meta row that combines the
 * manager identity, the AI match-strength badge (when an AI search is
 * active), the formatted date, and the secondary actions (favorite,
 * edit, delete). The earlier design split manager and footer into two
 * blocks separated by a hairline divider — that arrangement plus the
 * 24 px body padding produced ~190 px tall cards even with a one-word
 * title. The current layout collapses to ~100 px in the same case.
 */
const ProjectCard: React.FC<ProjectCardProps> = ({
    project,
    manager,
    liked,
    onLike,
    onEdit,
    onDelete
}) => {
    // Per-result strength badge (P1-2). Null when no AI search is active.
    const strength = getAiSearchStrength("projects", project._id);
    /*
     * MenuProps.items[].label used to wrap a nested `<button>` for each
     * entry, which stacked two interactive elements inside a single
     * `role="menuitem"` and required `stopPropagation` everywhere. The
     * AntD menu (rc-menu) already exposes a per-item `onClick`
     * handler that fires on both Enter/Space activation and mouse
     * clicks; using it lets the items render as plain string labels
     * with a single AT-readable name, and the Dropdown's own event
     * handling manages propagation correctly without the nested
     * stopPropagation calls.
     */
    const items: MenuProps["items"] = [
        {
            key: "edit",
            label: microcopy.actions.edit,
            onClick: () => onEdit()
        },
        {
            key: "delete",
            label: microcopy.actions.delete,
            danger: true,
            onClick: () => onDelete()
        }
    ];

    return (
        <Card>
            <Body>
                <HeaderRow>
                    <UserAvatar
                        id={project._id}
                        name={project.projectName}
                        size={40}
                        style={{
                            borderRadius: radius.md,
                            flex: "0 0 auto"
                        }}
                    />
                    <TitleStack>
                        <Organization>
                            {project.organization ||
                                microcopy.labels.noOrganization}
                        </Organization>
                        <TitleLink
                            href={`/projects/${project._id}`}
                            onClick={(event) => {
                                /*
                                 * Let modifier-clicks (Cmd/Ctrl + click,
                                 * middle-click) open the project in a new
                                 * tab — the browser handles those for free
                                 * when the anchor has a real `href`.
                                 */
                                if (
                                    event.metaKey ||
                                    event.ctrlKey ||
                                    event.shiftKey ||
                                    event.button !== 0
                                ) {
                                    return;
                                }
                                event.preventDefault();
                                /*
                                 * Force a real browser navigation — see
                                 * `nativeNavigate.ts`.
                                 */
                                nativeNavigate(`/projects/${project._id}`);
                            }}
                        >
                            {project.projectName}
                        </TitleLink>
                    </TitleStack>
                </HeaderRow>
                <MetaRow>
                    <Identity>
                        {manager ? (
                            <>
                                <UserAvatar
                                    id={manager._id}
                                    name={manager.username}
                                    size="small"
                                />
                                <span className="name">{manager.username}</span>
                            </>
                        ) : (
                            <>
                                <TeamOutlined aria-hidden />
                                <span className="name">
                                    {microcopy.feedback.noManager}
                                </span>
                            </>
                        )}
                        <MetaSeparator aria-hidden>·</MetaSeparator>
                        {strength ? (
                            <AiMatchStrengthBadge strength={strength} />
                        ) : null}
                        <DateChip>{formatDate(project.createdAt)}</DateChip>
                    </Identity>
                    <ActionsCluster>
                        <Button
                            aria-label={
                                liked
                                    ? microcopy.a11y.unlikeProject.replace(
                                          "{name}",
                                          project.projectName
                                      )
                                    : microcopy.a11y.likeProject.replace(
                                          "{name}",
                                          project.projectName
                                      )
                            }
                            aria-pressed={liked}
                            icon={
                                liked ? (
                                    <HeartFilled
                                        aria-hidden
                                        style={{ color: semantic.favorite }}
                                    />
                                ) : (
                                    <HeartOutlined aria-hidden />
                                )
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                onLike();
                            }}
                            size="small"
                            type="text"
                        />
                        <Dropdown
                            menu={{ items }}
                            placement="bottomRight"
                            trigger={["click"]}
                        >
                            <Button
                                aria-label={microcopy.a11y.moreActionsForProject.replace(
                                    "{name}",
                                    project.projectName
                                )}
                                icon={<MoreOutlined aria-hidden />}
                                onClick={(e) => e.stopPropagation()}
                                size="small"
                                type="text"
                            />
                        </Dropdown>
                    </ActionsCluster>
                </MetaRow>
            </Body>
        </Card>
    );
};

export const ProjectCardSkeleton: React.FC = () => (
    <Card aria-hidden>
        <Body>
            <HeaderRow>
                <Skeleton.Avatar
                    active
                    shape="square"
                    size={40}
                    style={{ borderRadius: radius.md }}
                />
                <TitleStack>
                    <Skeleton.Input active size="small" style={{ width: 80 }} />
                    <Skeleton.Input
                        active
                        size="small"
                        style={{ width: "80%" }}
                    />
                </TitleStack>
            </HeaderRow>
            <MetaRow>
                <Identity>
                    <Skeleton.Avatar active size="small" />
                    <Skeleton.Input active size="small" style={{ width: 96 }} />
                </Identity>
                <Skeleton.Input active size="small" style={{ width: 56 }} />
            </MetaRow>
        </Body>
    </Card>
);

export default ProjectCard;
