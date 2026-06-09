import styled from "@emotion/styled";
import { Alert, Breadcrumb, Button, Skeleton } from "antd";
import { useEffect } from "react";
import {
    Link,
    NavLink,
    Outlet,
    useLocation,
    useNavigate,
    useParams
} from "react-router-dom";

import EmptyState from "../components/emptyState";
import { microcopy } from "../constants/microcopy";
import {
    breakpoints,
    fontSize,
    fontWeight,
    radius,
    shadow,
    space
} from "../theme/tokens";
import useReactQuery from "../utils/hooks/useReactQuery";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";

const Container = styled.div`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    width: 100%;
`;

const TopBar = styled.div`
    align-items: center;
    /*
     * Frosted-glass secondary chrome. Mirrors the main header's
     * pattern: a translucent --glass-surface-subtle (~50 % opaque)
     * backed by backdrop-filter blur, so the breadcrumb + tabs row
     * stays legible when content is scrolled under it but the page
     * gradient and the page content still read clearly through the
     * bar at rest. The 1 px hairline border-bottom gives the chrome
     * a faint edge at rest. Pinned just below the main header at
     * top: var(--header-height), which the main header publishes via
     * a ResizeObserver.
     *
     * z-index 10 matches the main header; the bar is later in DOM
     * order so it stacks above the main header's bottom edge.
     *
     * Vertical padding tracks the main header's compact rhythm so the
     * two chrome layers feel cut from the same cloth.
     */
    background: var(--glass-surface-subtle);
    /* Wave 2 T4 — consume the global intensity lever so the
     * user-facing toggle (Clear / Regular / Solid) re-tunes the
     * secondary topbar along with the rest of the chrome. Pixel-
     * identical to the prior blur(20px) saturate(180%) recipe at
     * the default "regular" intensity. */
    backdrop-filter: var(--ant-backdrop-filter-glass);
    -webkit-backdrop-filter: var(--ant-backdrop-filter-glass);
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xxs}px;
    justify-content: space-between;
    min-width: 0;
    padding: ${space.xs}px ${space.sm}px;
    padding-inline-start: max(${space.sm}px, env(safe-area-inset-left));
    padding-inline-end: max(${space.sm}px, env(safe-area-inset-right));
    position: sticky;
    top: var(--header-height, 44px);
    z-index: 10;

    /*
     * Phase 5 "Liquid Glass" Wave 2 — top-leading specular rim.
     * Mirrors the main header recipe so the two chrome layers
     * (header + project breadcrumb) read as cut from the same cloth.
     */
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--glass-specular-top);
        pointer-events: none;
        z-index: 0;
    }

    /*
     * Bottom-trailing companion. ::after paints the soft trough on
     * the opposite corner from the rim highlight. The scroll-edge
     * dissolve is on the chrome element itself (below) — masking
     * ::after would only fade the rim shadow, not the actual chrome
     * surface that needs to taper.
     */
    &::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--glass-specular-bottom);
        pointer-events: none;
        z-index: 0;
    }

    /*
     * Scroll-edge dissolve: mask the bottom 12 px of the chrome
     * (including backdrop-filter + tinted background) so content
     * scrolling under the sticky bar fades up through the edge. The
     * 12 px lives in padding-bottom so the breadcrumb / tabs row
     * (the > * descendants) sit above the masked region and don't
     * get clipped. Same recipe as the page header.
     */
    padding-bottom: 12px;
    mask-image: linear-gradient(
        to bottom,
        black calc(100% - 12px),
        transparent 100%
    );
    -webkit-mask-image: linear-gradient(
        to bottom,
        black calc(100% - 12px),
        transparent 100%
    );

    /* Children sit above the rim pseudo-elements. */
    > * {
        position: relative;
        z-index: 1;
    }

    @media (min-width: ${breakpoints.sm}px) {
        gap: ${space.xs}px;
        padding: ${space.xs}px ${space.md}px;
        padding-inline-start: max(${space.md}px, env(safe-area-inset-left));
        padding-inline-end: max(${space.md}px, env(safe-area-inset-right));
    }

    @media (min-width: ${breakpoints.md}px) {
        gap: ${space.md}px;
        padding: ${space.xs}px ${space.lg}px;
        padding-inline-start: max(${space.lg}px, env(safe-area-inset-left));
        padding-inline-end: max(${space.lg}px, env(safe-area-inset-right));
    }

    /*
     * Honor the user's reduced-transparency preference: collapse the
     * glass surface to the solid page background and drop the blur.
     * Same recipe App.css uses on the body and on AntD modals/drawers.
     * Drop the rim + dissolve too so the opaque body doesn't compete
     * with achromatic gradients painted on top.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        background-attachment: fixed;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        padding-bottom: 0;
        mask-image: none;
        -webkit-mask-image: none;

        &::before,
        &::after {
            background: none;
        }
    }

    /*
     * Forced-colors mode (Windows high-contrast) replaces every author
     * colour with system tokens. Drop the rim layers so Canvas /
     * CanvasText win.
     */
    @media (forced-colors: active) {
        padding-bottom: 0;
        mask-image: none;
        -webkit-mask-image: none;

        &::before,
        &::after {
            background: none;
        }
    }

    box-shadow: ${shadow.sm};
`;

/*
 * flex-basis: auto reads as the breadcrumb's max-content width, which for a
 * 200-char project name is wider than the row, pushing the Board tab onto
 * its own line below. Pin the basis to 0 so the wrapper starts empty and
 * grows into whatever space the tabs leave behind; the inner ellipsis takes
 * care of the visual truncation.
 *
 * AntD Breadcrumb's inner <ol> is a flex container with flex-wrap: wrap, so
 * once the wrapper stops growing past max-content the long item wraps onto
 * a second row instead of getting truncated. Force nowrap on the ol and
 * pin the last item with min-width: 0 + overflow: hidden so it can shrink
 * and ellipsize in place.
 */
const BreadcrumbWrapper = styled.div`
    flex: 1 1 0;
    min-width: 0;

    && .ant-breadcrumb {
        font-size: ${fontSize.sm}px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    && .ant-breadcrumb ol {
        flex-wrap: nowrap;
        min-width: 0;
    }
    && .ant-breadcrumb li,
    && .ant-breadcrumb-link {
        min-width: 0;
    }
    && .ant-breadcrumb li:not(:last-child),
    && .ant-breadcrumb li:not(:last-child) .ant-breadcrumb-link,
    && .ant-breadcrumb li:not(:last-child) a {
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    && .ant-breadcrumb li:last-child {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
        font-weight: ${fontWeight.semibold};
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    @media (pointer: coarse) {
        && .ant-breadcrumb a {
            align-items: center;
            display: inline-flex;
            min-height: 44px;
        }
    }
`;

const Body = styled.div`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
`;

/*
 * Phase 4.7: re-introduce a small in-page nav alongside the
 * breadcrumb now that the project detail has more than one child
 * route (Board + Reports). Renders as a row of `<NavLink>`s with a
 * stable `aria-current="page"` attribute on the active link so
 * keyboard / SR users can tell where they are. We deliberately ship
 * a plain link row (not AntD Tabs) so a future third entry doesn't
 * have to re-introduce the Tabs/ink-bar machinery QW-11 deleted.
 *
 * Keep the row inside the same TopBar so the chrome stays a single
 * sticky band; `flex-wrap: wrap` lets the breadcrumb and the nav
 * row sit side by side on wide viewports and stack on phones.
 */
const ChildNav = styled.nav`
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: ${space.xs}px;
`;

const ChildNavLink = styled(NavLink)`
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
    line-height: 1.2;
    padding: ${space.xs}px ${space.sm}px;
    text-decoration: none;
    /*
     * Phase 5 "Liquid Glass" Wave 2 — gel-flex on breadcrumb tabs.
     * Mirrors the header / bottom-tab gel-flex so every interactive
     * chrome surface in the app yields under press with the same
     * cadence. transform-only; the tap target stays intact.
     */
    transition: transform var(--motion-gel-flex, 220ms)
        var(--easing-spring-snap, ease-out);
    will-change: transform;
    /*
     * 44 px minimum tap target on the link row. WCAG 2.5.5 — the
     * link row is one of the first interactive surfaces a touch
     * user reaches when entering a project, so the floor is on
     * everywhere rather than gated on coarse pointers.
     */
    min-height: 36px;

    @media (pointer: coarse) {
        min-height: 44px;
    }

    &:hover,
    &:focus-visible {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.06));
        color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    }

    &:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 1px;
    }

    &:active {
        transform: scale(0.97);
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;

        &:active {
            transform: none;
        }
    }

    /* React Router's NavLink toggles an aria-current attribute when
     * the link is the active route — paint the active state on that
     * attribute so the visible style and the AT contract stay in
     * lockstep. */
    &[aria-current="page"] {
        background: var(--ant-color-fill-secondary, rgba(15, 23, 42, 0.06));
        color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
        font-weight: ${fontWeight.semibold};
    }
`;

const ProjectDetailPage = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const isPhoneChrome = useIsPhoneChrome();

    const {
        data: project,
        isLoading: pLoading,
        isSuccess: pSuccess,
        error: pError,
        refetch: refetchProject
    } = useReactQuery<IProject>("projects", { projectId });

    /*
     * A successful query that returns a falsy body is treated as not-found —
     * the JSON-server mock can return `null` / empty for an unknown id, and
     * we should surface a friendly 404 rather than render the board outlet
     * against a phantom project.
     */
    const isNotFound = pSuccess && !project;

    /*
     * Detect the active child route from the URL so the breadcrumb
     * can append a third crumb for sibling surfaces. Board is the
     * project's index destination — keeping "Projects > Atlas" as
     * the full crumb there avoids redundant chrome. Reports (and
     * any future non-board surface) gets its own leaf crumb so the
     * user can see exactly where they are.
     */
    const segments = pathname.split("/").filter(Boolean);
    const activeChild = segments[segments.length - 1];
    const childCrumbTitle =
        activeChild === "reports"
            ? microcopy.breadcrumb.reports
            : activeChild === "members"
              ? microcopy.labels.members
              : activeChild === "milestones"
                ? microcopy.labels.milestones
                : activeChild === "labels"
                  ? microcopy.labels.labels
                  : null;

    /*
     * Browser tab title mirrors the current project. Leaf child
     * routes that need a page-qualified title (e.g. "Reports ·
     * Atlas") call `useTitle` themselves; React commits effects
     * child-before-parent, so on a naive `useTitle(projectName)`
     * here the parent's effect would fire after the leaf's and
     * undo the qualifier on every re-render.
     *
     * Inline the effect (rather than relying on `useTitle`) so we
     * can skip the write entirely when a child route owns the title.
     * The board / index route lets the shell own the title; the
     * Reports route skips so its own `useTitle("Reports · {project}")`
     * commits last and sticks.
     */
    const shellOwnsTitle =
        activeChild !== "reports" &&
        activeChild !== "members" &&
        activeChild !== "milestones" &&
        activeChild !== "labels";
    const shellTitle = project?.projectName ?? microcopy.labels.project;
    useEffect(() => {
        if (!shellOwnsTitle) return;
        document.title = shellTitle;
    }, [shellOwnsTitle, shellTitle]);

    const breadcrumbItems = [
        {
            title: (
                <Link to="/projects" viewTransition>
                    {microcopy.breadcrumb.projects}
                </Link>
            )
        },
        {
            title:
                pLoading && !project ? (
                    <Skeleton.Input
                        active
                        size="small"
                        style={{ width: 160 }}
                    />
                ) : childCrumbTitle ? (
                    /*
                     * When a child route is active, the project name
                     * becomes a link back to the project root (which
                     * declaratively redirects to /board) so the user
                     * can navigate up from Reports back to the board
                     * via the breadcrumb. The leaf crumb carries
                     * `aria-current="page"`.
                     */
                    <Link to={`/projects/${projectId}`} viewTransition>
                        {project?.projectName ?? microcopy.labels.project}
                    </Link>
                ) : (
                    <span aria-current="page">
                        {project?.projectName ?? microcopy.labels.project}
                    </span>
                )
        },
        ...(childCrumbTitle
            ? [
                  {
                      title: <span aria-current="page">{childCrumbTitle}</span>
                  }
              ]
            : [])
    ];

    return (
        <Container>
            {!(isPhoneChrome && activeChild === "board") ? (
                <TopBar
                    data-glass-context="true"
                    data-testid="project-detail-chrome"
                >
                    <BreadcrumbWrapper>
                        <Breadcrumb items={breadcrumbItems} />
                    </BreadcrumbWrapper>
                    {/*
                     * In-project navigation (Phase 4.7). Hidden while the
                     * project query is in-flight to avoid a layout
                     * flicker; we surface it as soon as the project
                     * resolves so the nav row can't outlive a 404 body.
                     */}
                    {project && projectId && !isPhoneChrome ? (
                        <ChildNav
                            aria-label={microcopy.labels.projectSections}
                            data-testid="project-detail-child-nav"
                        >
                            <ChildNavLink
                                end
                                to={`/projects/${projectId}/board`}
                                viewTransition
                            >
                                {microcopy.labels.board}
                            </ChildNavLink>
                            <ChildNavLink
                                end
                                to={`/projects/${projectId}/members`}
                                viewTransition
                            >
                                {microcopy.labels.members}
                            </ChildNavLink>
                            <ChildNavLink
                                end
                                to={`/projects/${projectId}/milestones`}
                                viewTransition
                            >
                                {microcopy.labels.milestones}
                            </ChildNavLink>
                            <ChildNavLink
                                end
                                to={`/projects/${projectId}/labels`}
                                viewTransition
                            >
                                {microcopy.labels.labels}
                            </ChildNavLink>
                            <ChildNavLink
                                end
                                to={`/projects/${projectId}/reports`}
                                viewTransition
                            >
                                {microcopy.labels.reports}
                            </ChildNavLink>
                        </ChildNav>
                    ) : null}
                </TopBar>
            ) : null}
            <Body>
                {pError ? (
                    <Alert
                        action={
                            <Button
                                onClick={() => refetchProject()}
                                size="small"
                                type="primary"
                            >
                                {microcopy.actions.retry}
                            </Button>
                        }
                        description={microcopy.feedback.retryHint}
                        message={microcopy.feedback.loadFailed}
                        showIcon
                        style={{ margin: space.md }}
                        type="error"
                    />
                ) : isNotFound ? (
                    <EmptyState
                        title={microcopy.empty.notFound.title}
                        description={microcopy.empty.notFound.description}
                        cta={
                            <Button
                                onClick={() =>
                                    navigate("/projects", {
                                        viewTransition: true
                                    })
                                }
                                type="primary"
                            >
                                {microcopy.empty.notFound.cta}
                            </Button>
                        }
                    />
                ) : (
                    <Outlet />
                )}
            </Body>
        </Container>
    );
};

export default ProjectDetailPage;
