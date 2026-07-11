import styled from "@emotion/styled";
import { CircleAlert } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import {
    Link,
    NavLink,
    Outlet,
    useLocation,
    useNavigate,
    useParams
} from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
 * Composed breadcrumb (replaces AntD `Breadcrumb`). A semantic
 * `<nav><ol><li>` trail with a separator glyph between crumbs.
 *
 * flex-basis: auto reads as the breadcrumb's max-content width, which for a
 * 200-char project name is wider than the row, pushing the Board tab onto
 * its own line below. Pin the basis to 0 so the wrapper starts empty and
 * grows into whatever space the tabs leave behind; the inner ellipsis takes
 * care of the visual truncation.
 *
 * The <ol> is a nowrap flex row so a long project name truncates in place
 * instead of wrapping to a second line: the root crumb never shrinks, the
 * middle (project-name link) ellipsizes on its inner span, and the current
 * (last) crumb clips with an ellipsis.
 */
const Breadcrumb = styled.nav`
    flex: 1 1 0;
    min-width: 0;

    & ol {
        align-items: center;
        display: flex;
        flex-wrap: nowrap;
        font-size: ${fontSize.sm}px;
        gap: ${space.xxs}px;
        list-style: none;
        margin: 0;
        min-width: 0;
        padding: 0;
    }

    & li {
        align-items: center;
        display: inline-flex;
        min-width: 0;
    }

    & a {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
        text-decoration: none;
    }
    & a:hover,
    & a:focus-visible {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
        text-decoration: underline;
    }

    & [data-breadcrumb-separator] {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
        flex: 0 0 auto;
        margin-inline: ${space.xxs}px;
    }

    /* Root crumb ("Projects") never shrinks or ellipsizes. */
    & li:first-of-type {
        flex-shrink: 0;
    }
    & li:first-of-type a {
        flex-shrink: 0;
        max-width: none;
        overflow: visible;
        text-overflow: clip;
        white-space: nowrap;
    }

    /*
     * The project-name anchor is inline-flex (it carries the 44 px
     * coarse-pointer touch target below), and text-overflow does not
     * ellipsize the contents of a flex container — the glyphs hard-clip
     * at the box edge instead. Keep the anchor as the sized/clipped
     * flex box and move the ellipsis onto the inner span, which as a
     * min-width: 0 flex item truncates correctly.
     */
    & li[data-breadcrumb="middle"] {
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
    }
    & li[data-breadcrumb="middle"] a {
        align-items: center;
        display: inline-flex;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
    }
    & li[data-breadcrumb="middle"] a > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    & li:last-of-type {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
        font-weight: ${fontWeight.semibold};
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    @media (pointer: coarse) {
        & a {
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
 *
 * On phone chrome ($scrollable) the row takes the full chrome width
 * under the breadcrumb and pans horizontally instead of wrapping, so
 * all five sections stay reachable on narrow viewports without the
 * chrome growing several rows tall. The scrollbar is suppressed so
 * the row reads as a segmented control; the links themselves are the
 * scroll affordance.
 */
const ChildNav = styled.nav<{ $scrollable: boolean }>`
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: ${space.xs}px;

    ${(props) =>
        props.$scrollable
            ? `
    flex: 1 1 100%;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    &::-webkit-scrollbar {
        display: none;
    }
    `
            : ""}
`;

const ChildNavLink = styled(NavLink)`
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    /* Fixed-size segments inside the (possibly scrollable) nav row —
     * a link must never shrink or wrap mid-label, otherwise the
     * horizontal pan on phone chrome clips labels instead of panning. */
    flex: 0 0 auto;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
    line-height: 1.2;
    padding: ${space.xs}px ${space.sm}px;
    text-decoration: none;
    white-space: nowrap;
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

    const crumbs: ReactNode[] = [
        <Link key="projects" to="/projects" viewTransition>
            {microcopy.breadcrumb.projects}
        </Link>,
        pLoading && !project ? (
            <Skeleton key="project" style={{ height: 16, width: 160 }} />
        ) : childCrumbTitle ? (
            /*
             * When a child route is active, the project name becomes a
             * link back to the project root (which declaratively
             * redirects to /board) so the user can navigate up from
             * Reports back to the board via the breadcrumb. The leaf
             * crumb carries `aria-current="page"`.
             */
            <Link key="project" to={`/projects/${projectId}`} viewTransition>
                <span>{project?.projectName ?? microcopy.labels.project}</span>
            </Link>
        ) : (
            <span key="project" aria-current="page">
                {project?.projectName ?? microcopy.labels.project}
            </span>
        ),
        ...(childCrumbTitle
            ? [
                  <span key="child" aria-current="page">
                      {childCrumbTitle}
                  </span>
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
                    <Breadcrumb
                        aria-label={microcopy.breadcrumb.ariaLabel}
                        data-testid="project-breadcrumb"
                    >
                        <ol>
                            {crumbs.map((crumb, index) => {
                                const position =
                                    index === 0
                                        ? "root"
                                        : index === crumbs.length - 1
                                          ? "current"
                                          : "middle";
                                return (
                                    <li key={index} data-breadcrumb={position}>
                                        {index > 0 ? (
                                            <span
                                                aria-hidden
                                                data-breadcrumb-separator
                                            >
                                                /
                                            </span>
                                        ) : null}
                                        {crumb}
                                    </li>
                                );
                            })}
                        </ol>
                    </Breadcrumb>
                    {/*
                     * In-project navigation (Phase 4.7). Hidden while the
                     * project query is in-flight to avoid a layout
                     * flicker; we surface it as soon as the project
                     * resolves so the nav row can't outlive a 404 body.
                     * On phone chrome the row renders as a horizontally
                     * scrollable segment strip — previously it was hidden
                     * there entirely, leaving Members / Milestones /
                     * Labels / Reports unreachable by touch.
                     */}
                    {project && projectId ? (
                        <ChildNav
                            $scrollable={isPhoneChrome}
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
                    <Alert variant="destructive" style={{ margin: space.md }}>
                        <CircleAlert aria-hidden />
                        <AlertTitle>{microcopy.feedback.loadFailed}</AlertTitle>
                        <AlertDescription>
                            {microcopy.feedback.retryHint}
                        </AlertDescription>
                        <div style={{ marginTop: space.sm }}>
                            <Button
                                onClick={() => refetchProject()}
                                size="sm"
                                variant="primary"
                            >
                                {microcopy.actions.retry}
                            </Button>
                        </div>
                    </Alert>
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
                                variant="primary"
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
