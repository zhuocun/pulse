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
import { cn } from "@/lib/utils";
import EmptyState from "../components/emptyState";
import { microcopy } from "../constants/microcopy";
import { shadow, space } from "../theme/tokens";
import useReactQuery from "../utils/hooks/useReactQuery";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";

const CONTAINER_CLASS = "flex flex-1 flex-col min-h-0 w-full";

/*
 * Frosted-glass secondary chrome. Mirrors the main header's pattern: a
 * translucent `--glass-surface-subtle` backed by `backdrop-filter` blur, so
 * the breadcrumb + tabs row stays legible when content is scrolled under it
 * but the page gradient still reads through at rest. Pinned just below the
 * main header at `top: var(--header-height)`, which the header publishes via
 * a ResizeObserver.
 *
 * The specular ::before / ::after rim layers, the scroll-edge mask, and the
 * reduced-transparency / forced-colors fallbacks mirror the header glass
 * recipe. `box-shadow` (`shadow.sm`) is applied inline so the token stays the
 * single source of truth. Padding tracks the header's compact rhythm.
 */
const TOP_BAR_CLASS = cn(
    "sticky z-10 flex flex-wrap items-center justify-between gap-xxs min-w-0",
    "[top:var(--header-height,44px)]",
    "[background:var(--glass-surface-subtle)] [border-bottom:1px_solid_var(--glass-border)]",
    "[backdrop-filter:var(--pulse-backdrop-filter-glass)] [-webkit-backdrop-filter:var(--pulse-backdrop-filter-glass)]",
    "py-xs px-sm",
    "[padding-inline-start:max(var(--pulse-space-sm),env(safe-area-inset-left))]",
    "[padding-inline-end:max(var(--pulse-space-sm),env(safe-area-inset-right))]",
    "pb-[12px]",
    "[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent_100%)]",
    "[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent_100%)]",
    "before:content-[''] before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:bg-[image:var(--glass-specular-top)]",
    "after:content-[''] after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:bg-[image:var(--glass-specular-bottom)]",
    "[&>*]:relative [&>*]:z-[1]",
    "[@media(prefers-reduced-transparency:reduce)]:[background:var(--page-background)]",
    "[@media(prefers-reduced-transparency:reduce)]:[background-attachment:fixed]",
    "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none]",
    "[@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none]",
    "[@media(prefers-reduced-transparency:reduce)]:pb-0",
    "[@media(prefers-reduced-transparency:reduce)]:[mask-image:none]",
    "[@media(prefers-reduced-transparency:reduce)]:[-webkit-mask-image:none]",
    "[@media(prefers-reduced-transparency:reduce)]:before:bg-none",
    "[@media(prefers-reduced-transparency:reduce)]:after:bg-none",
    "forced-colors:pb-0 forced-colors:[mask-image:none] forced-colors:[-webkit-mask-image:none]",
    "forced-colors:before:bg-none forced-colors:after:bg-none",
    "min-[480px]:gap-xs min-[480px]:px-md",
    "min-[480px]:[padding-inline-start:max(var(--pulse-space-md),env(safe-area-inset-left))]",
    "min-[480px]:[padding-inline-end:max(var(--pulse-space-md),env(safe-area-inset-right))]",
    "md:gap-md md:px-lg",
    "md:[padding-inline-start:max(var(--pulse-space-lg),env(safe-area-inset-left))]",
    "md:[padding-inline-end:max(var(--pulse-space-lg),env(safe-area-inset-right))]"
);

/*
 * Composed breadcrumb (replaces AntD `Breadcrumb`). A semantic
 * `<nav><ol><li>` trail with a separator glyph between crumbs. The <ol> is a
 * nowrap flex row so a long project name truncates in place: the root crumb
 * never shrinks, the middle (project-name link) ellipsizes on its inner span,
 * and the current (last) crumb clips with an ellipsis. `flex-[1_1_0]` pins
 * the wrapper basis to 0 so a 200-char name can't push the tabs to a second
 * row. Colours thread the app-owned `--pulse-*` tokens (formerly AntD's
 * `--ant-color-*`).
 */
const BREADCRUMB_CLASS = cn(
    "flex-[1_1_0] min-w-0",
    "[&_ol]:flex [&_ol]:flex-nowrap [&_ol]:items-center [&_ol]:gap-xxs [&_ol]:m-0 [&_ol]:min-w-0 [&_ol]:list-none [&_ol]:p-0 [&_ol]:text-sm",
    "[&_li]:inline-flex [&_li]:items-center [&_li]:min-w-0",
    "[&_a]:no-underline [&_a]:[color:var(--pulse-text-secondary)]",
    "[&_a:hover]:underline [&_a:hover]:[color:var(--pulse-text-base)]",
    "[&_a:focus-visible]:underline [&_a:focus-visible]:[color:var(--pulse-text-base)]",
    "[&_[data-breadcrumb-separator]]:flex-[0_0_auto] [&_[data-breadcrumb-separator]]:mx-xxs [&_[data-breadcrumb-separator]]:[color:var(--pulse-text-tertiary)]",
    // Root crumb ("Projects") never shrinks or ellipsizes.
    "[&_li:first-of-type]:flex-shrink-0",
    "[&_li:first-of-type_a]:flex-shrink-0 [&_li:first-of-type_a]:max-w-none [&_li:first-of-type_a]:overflow-visible [&_li:first-of-type_a]:[text-overflow:clip] [&_li:first-of-type_a]:whitespace-nowrap",
    // The middle (project-name) anchor is a clipped inline-flex box; the
    // ellipsis lives on its inner span since text-overflow can't ellipsize a
    // flex container's contents.
    "[&_li[data-breadcrumb=middle]]:max-w-full [&_li[data-breadcrumb=middle]]:min-w-0 [&_li[data-breadcrumb=middle]]:overflow-hidden",
    "[&_li[data-breadcrumb=middle]_a]:inline-flex [&_li[data-breadcrumb=middle]_a]:items-center [&_li[data-breadcrumb=middle]_a]:max-w-full [&_li[data-breadcrumb=middle]_a]:min-w-0 [&_li[data-breadcrumb=middle]_a]:overflow-hidden [&_li[data-breadcrumb=middle]_a]:whitespace-nowrap",
    "[&_li[data-breadcrumb=middle]_a>span]:min-w-0 [&_li[data-breadcrumb=middle]_a>span]:overflow-hidden [&_li[data-breadcrumb=middle]_a>span]:text-ellipsis [&_li[data-breadcrumb=middle]_a>span]:whitespace-nowrap",
    "[&_li:last-of-type]:min-w-0 [&_li:last-of-type]:overflow-hidden [&_li:last-of-type]:text-ellipsis [&_li:last-of-type]:whitespace-nowrap [&_li:last-of-type]:font-semibold [&_li:last-of-type]:[color:var(--pulse-text-base)]",
    // 44 px coarse-pointer touch target on every crumb link.
    "coarse:[&_a]:inline-flex coarse:[&_a]:items-center coarse:[&_a]:min-h-[44px]"
);

const BODY_CLASS = "flex flex-1 flex-col min-h-0 overflow-auto";

/*
 * Phase 4.7: a small in-page nav alongside the breadcrumb (Board / Members /
 * Milestones / Labels / Reports). A plain `<NavLink>` row (not AntD Tabs)
 * whose active link carries `aria-current="page"`. Kept inside the same
 * TopBar so the chrome stays a single sticky band; `flex-wrap: wrap` on the
 * TopBar lets the breadcrumb and this row sit side by side on wide viewports
 * and stack on phones.
 */
const CHILD_NAV_BASE_CLASS = "flex items-center gap-xs flex-[0_0_auto]";

/*
 * On phone chrome the row takes the full chrome width under the breadcrumb
 * and pans horizontally instead of wrapping, so all five sections stay
 * reachable without the chrome growing several rows tall. The scrollbar is
 * suppressed so the row reads as a segmented control.
 */
const CHILD_NAV_SCROLLABLE_CLASS = cn(
    "flex-[1_1_100%] min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch]",
    "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
);

/*
 * A single breadcrumb tab. Fixed-size segments (`flex-[0_0_auto]`,
 * `whitespace-nowrap`) so a link never shrinks or wraps mid-label, otherwise
 * the horizontal pan on phone chrome would clip labels. The gel-flex press
 * mirrors the header / bottom-tab recipe (transform-only; the tap target
 * stays intact). The active `aria-current="page"` state paints on the
 * attribute so the visible style and the AT contract stay in lockstep.
 * Colours thread the app-owned `--pulse-*` tokens.
 */
const CHILD_NAV_LINK_CLASS = cn(
    "flex-[0_0_auto] rounded-sm px-sm py-xs text-sm font-medium no-underline whitespace-nowrap",
    "[line-height:1.2] will-change-transform min-h-[36px]",
    "[transition:transform_var(--motion-gel-flex,220ms)_var(--easing-spring-snap,ease-out)]",
    "[color:var(--pulse-text-secondary)]",
    "hover:[background:var(--pulse-fill-tertiary)] hover:[color:var(--pulse-text-base)]",
    "focus-visible:[background:var(--pulse-fill-tertiary)] focus-visible:[color:var(--pulse-text-base)]",
    "focus-visible:[outline:2px_solid_var(--pulse-brand-primary)] focus-visible:[outline-offset:1px]",
    "active:scale-[0.97]",
    "motion-reduce:[transition:none] motion-reduce:active:scale-100",
    "coarse:min-h-[44px]",
    "aria-[current=page]:[background:var(--pulse-fill-secondary)] aria-[current=page]:[color:var(--pulse-text-base)] aria-[current=page]:font-semibold"
);

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
        <div className={CONTAINER_CLASS}>
            {!(isPhoneChrome && activeChild === "board") ? (
                <div
                    className={TOP_BAR_CLASS}
                    style={{ boxShadow: shadow.sm }}
                    data-glass-context="true"
                    data-testid="project-detail-chrome"
                >
                    <nav
                        className={BREADCRUMB_CLASS}
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
                    </nav>
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
                        <nav
                            className={cn(
                                CHILD_NAV_BASE_CLASS,
                                isPhoneChrome && CHILD_NAV_SCROLLABLE_CLASS
                            )}
                            aria-label={microcopy.labels.projectSections}
                            data-testid="project-detail-child-nav"
                        >
                            <NavLink
                                className={CHILD_NAV_LINK_CLASS}
                                end
                                to={`/projects/${projectId}/board`}
                                viewTransition
                            >
                                {microcopy.labels.board}
                            </NavLink>
                            <NavLink
                                className={CHILD_NAV_LINK_CLASS}
                                end
                                to={`/projects/${projectId}/members`}
                                viewTransition
                            >
                                {microcopy.labels.members}
                            </NavLink>
                            <NavLink
                                className={CHILD_NAV_LINK_CLASS}
                                end
                                to={`/projects/${projectId}/milestones`}
                                viewTransition
                            >
                                {microcopy.labels.milestones}
                            </NavLink>
                            <NavLink
                                className={CHILD_NAV_LINK_CLASS}
                                end
                                to={`/projects/${projectId}/labels`}
                                viewTransition
                            >
                                {microcopy.labels.labels}
                            </NavLink>
                            <NavLink
                                className={CHILD_NAV_LINK_CLASS}
                                end
                                to={`/projects/${projectId}/reports`}
                                viewTransition
                            >
                                {microcopy.labels.reports}
                            </NavLink>
                        </nav>
                    ) : null}
                </div>
            ) : null}
            <div className={BODY_CLASS}>
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
            </div>
        </div>
    );
};

export default ProjectDetailPage;
