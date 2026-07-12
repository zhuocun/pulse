import { Building2, CircleAlert, LayoutGrid, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import AiSearchInput from "../components/aiSearchInput";
import AiSparkleIcon from "../components/aiSparkleIcon";
import PageContainer from "../components/pageContainer";
import ProjectList from "../components/projectList";
import ProjectSearchPanel from "../components/projectSearchPanel";
import PullToRefresh from "../components/pullToRefresh";
import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";
import type { ProjectListSort } from "../store/reducers/userPreferencesSlice";
import { accent, space } from "../theme/tokens";
import SrOnlyLive from "../utils/a11y/SrOnlyLive";
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useCopilotDock from "../utils/hooks/useCopilotDock";
import useDebounce from "../utils/hooks/useDebounce";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";
import useMembersList from "../utils/hooks/useMembersList";
import useProjectListDefaults from "../utils/hooks/useProjectListDefaults";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";
import useUrl from "../utils/hooks/useUrl";

/*
 * Phase 4.2 — narrowing helper for the URL-shaped sort param. The URL
 * surface is `string | null`; the project-list sort selector accepts
 * the five-mode `ProjectListSort` union. Unknown / missing values fall
 * back to the caller-supplied default (typically the saved default
 * sort, or the fallback `createdAt-desc`).
 */
const PROJECT_LIST_SORT_VALUES: readonly ProjectListSort[] = [
    "createdAt-desc",
    "createdAt-asc",
    "name-asc",
    "name-desc",
    "favorited-first"
] as const;

const narrowSort = (
    value: string | null,
    fallback: ProjectListSort
): ProjectListSort =>
    (PROJECT_LIST_SORT_VALUES as readonly string[]).includes(value ?? "")
        ? (value as ProjectListSort)
        : fallback;

/*
 * One/other plural resolution (the codebase-wide pattern — see
 * `projectList` / `commandPalette`): pick the key off the count,
 * interpolate `{count}`. No ICU formatter exists in this codebase.
 */
const pluralCount = (
    pair: { one: string; other: string },
    count: number
): string =>
    (count === 1 ? pair.one : pair.other).replace("{count}", String(count));

const PAGE_HEADER_CLASS = cn(
    "flex flex-wrap items-end justify-between gap-sm [row-gap:var(--pulse-space-xs)] mb-lg",
    "md:mb-xl"
);

const PAGE_HEADING_CLASS = cn(
    "text-xl font-semibold tracking-tight leading-tight m-0 min-w-0",
    "md:text-xxl"
);

const PAGE_SUBHEADING_CLASS = cn(
    "text-base leading-normal [margin:var(--pulse-space-xxs)_0_0] max-w-[56ch]",
    "[color:var(--pulse-text-secondary)]",
    "max-[767px]:hidden"
);

const MOBILE_FIRST_SECTION_CLASS = cn(
    "contents",
    "max-[767px]:flex max-[767px]:flex-col max-[767px]:gap-md"
);

const DESKTOP_FIRST_SECTION_CLASS = "contents";

const PAGE_HEADING_GROUP_CLASS = "flex-[1_1_auto] min-w-0";

const TOOLBAR_CLASS = cn(
    "flex flex-wrap flex-shrink-0 items-center gap-xs",
    "max-[479px]:basis-full max-[479px]:[&>button]:flex-[1_1_0] max-[479px]:[&>.relative]:flex-[1_1_0]"
);

const STAT_RAIL_CLASS = cn(
    "hidden grid-cols-3 gap-xs mb-md",
    "md:grid md:gap-sm md:mb-lg"
);

const COMPACT_STATS_LINE_CLASS = "block mb-sm md:hidden";

/*
 * Stat card. On phone-sized viewports everything centres because the
 * StatHeader stacks its icon over the label, so a left-aligned value would
 * float awkwardly off-axis. Border + surface thread the app-owned
 * `--pulse-*` tokens (formerly AntD's `--ant-color-*`).
 */
const STAT_CARD_CLASS = cn(
    "relative flex flex-col items-start gap-[2px] min-w-0 rounded-lg px-sm py-xs",
    "[background:var(--pulse-bg-container,#fff)] [border:1px_solid_var(--pulse-border-secondary)]",
    "max-[479px]:items-center max-[479px]:gap-xxs max-[479px]:text-center",
    "min-[480px]:gap-xxs min-[480px]:px-lg min-[480px]:py-md"
);

/*
 * Stack the icon above the label on phone-sized viewports so the label
 * claims the full card width instead of sharing it with the icon + gap. On
 * sm+ the inline row returns since the cards are wide enough.
 */
const STAT_HEADER_CLASS = cn(
    "flex items-center gap-xs min-w-0 w-full [color:var(--pulse-text-tertiary)]",
    "max-[479px]:flex-col max-[479px]:gap-xxs"
);

/* Icon-glyph stays compact; the surrounding pill carries the colour. */
const STAT_ICON_CLASS = cn(
    "inline-flex flex-[0_0_auto] items-center justify-center h-6 w-6 rounded-sm",
    "[color:var(--pulse-brand-primary,#ea580c)] [&_svg]:h-[14px] [&_svg]:w-[14px]",
    "max-[479px]:h-5 max-[479px]:w-5 max-[479px]:[&_svg]:h-3 max-[479px]:[&_svg]:w-3"
);

/*
 * `StatCard` uses `items-start` (so values don't stretch), which sizes
 * children to their content on the cross axis, so the `max-w-full` cap +
 * ellipsis keep a long label ("Team members") from spilling. Below sm the
 * label gets the whole card width once the header stacks: shrink a notch and
 * wrap on the space (`keep-all` + `whitespace-normal`) rather than splitting
 * a single token mid-character.
 */
const STAT_LABEL_CLASS = cn(
    "text-xs font-medium max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
    "[color:var(--pulse-text-tertiary)]",
    "max-[479px]:[font-size:clamp(10px,2.9vw,11px)] max-[479px]:leading-tight max-[479px]:text-center max-[479px]:whitespace-normal max-[479px]:[word-break:keep-all]"
);

const STAT_VALUE_CLASS = cn(
    "text-md font-semibold tracking-tight [color:var(--pulse-text-base)]",
    "min-[480px]:text-xl"
);

const ProjectPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.projects), false);
    const { openModal } = useProjectModal();
    const { enabled: aiEnabled } = useAiEnabled();
    const isPhone = useIsPhoneChrome();
    const { openDrawer: openChatDrawer } = useAiChatDrawer();
    /*
     * Phase 4 A8 — launcher badge subscription mirrors the Board
     * Copilot menu's badge on `pages/board.tsx`. We surface the same
     * unread count on the project-list "Ask" Copilot launcher so the
     * user sees the badge even when they're between boards (the dock
     * itself is still hidden because there's no projectId yet; the
     * badge tells them "something landed on a board you triaged
     * earlier this session").
     */
    const { inboxUnreadCount: copilotInboxUnread } = useCopilotDock();
    // Pick the one/other locale key off the count and interpolate. The
    // strings are plain placeholders (no ICU syntax); the .replace call
    // is the entire formatter. Skip altogether when count is zero so the
    // Badge collapses without an aria-label.
    const copilotUnreadAriaLabel = copilotInboxUnread
        ? (copilotInboxUnread === 1
              ? microcopy.copilotDock.inboxTab.unreadBadgeAriaLabelOne
              : microcopy.copilotDock.inboxTab.unreadBadgeAriaLabelOther
          ).replace("{count}", String(copilotInboxUnread))
        : undefined;
    /*
     * PWA manifest shortcuts (`/projects?openTaskCreator=1`,
     * `/projects?openCopilot=1`) fire from the OS launcher long-press menu.
     * Read the params on mount, dispatch the matching open action, then
     * strip the param so the back-button gesture (and a remount) don't
     * re-fire. The ref guard makes the once-per-mount contract explicit
     * — without it, the URL-strip below would re-enter this effect via
     * the searchParams subscription on the very next render.
     *
     * The `openTaskCreator` param is a historical name kept for backwards
     * compatibility with installed manifests; the user-facing PWA
     * shortcut is "New project" because the project list page has no
     * task creator — `openModal()` opens the project-create modal.
     */
    const [shortcutSearchParams, setShortcutSearchParams] = useSearchParams();
    const shortcutsFiredRef = useRef(false);
    useEffect(() => {
        if (shortcutsFiredRef.current) return;
        const wantsTaskCreator =
            shortcutSearchParams.get("openTaskCreator") === "1";
        const wantsCopilot = shortcutSearchParams.get("openCopilot") === "1";
        if (!wantsTaskCreator && !wantsCopilot) return;
        shortcutsFiredRef.current = true;
        // `openTaskCreator` (legacy param name) opens the project-create
        // modal — the PWA shortcut is labeled "New project" to match
        // actual behavior. `openCopilot` flips the chat-drawer Redux flag,
        // which `CopilotDockHost`'s bridge forwards to the persistent dock.
        if (wantsTaskCreator) openModal();
        if (wantsCopilot) openChatDrawer();
        const next = new URLSearchParams(shortcutSearchParams);
        next.delete("openTaskCreator");
        next.delete("openCopilot");
        setShortcutSearchParams(next, { replace: true });
    }, [
        openChatDrawer,
        openModal,
        setShortcutSearchParams,
        shortcutSearchParams
    ]);
    const [param, setParam] = useUrl([
        "projectName",
        "managerId",
        "semanticIds",
        "sort",
        "favoritedOnly"
    ]);
    /*
     * Phase 4.2 — saved project-list defaults. On first load (no filter
     * / sort params in the URL) push the saved defaults (or the
     * `PROJECT_LIST_DEFAULTS_FALLBACK` baseline of `createdAt-desc` +
     * no manager + unfavorited) into the URL so the user lands on
     * their preferred view. After first apply the page yields to the
     * URL — explicit filter changes do NOT update the saved default;
     * the user must click "Save as default" in the search panel.
     */
    const {
        defaults: projectListDefaults,
        savedDefaults: savedProjectListDefaults,
        saveDefaults: saveProjectListDefaults,
        clearDefaults: clearProjectListDefaults
    } = useProjectListDefaults();
    const defaultsAppliedRef = useRef(false);
    useEffect(() => {
        if (defaultsAppliedRef.current) return;
        // Treat first-load as the moment when EVERY filter/sort param is
        // missing from the URL. Any non-empty value (deep-linked share,
        // back/forward from another route) means the user has explicit
        // intent — leave them alone.
        const isEmpty =
            !param.projectName &&
            !param.managerId &&
            !param.semanticIds &&
            !param.sort &&
            !param.favoritedOnly;
        if (!isEmpty) {
            defaultsAppliedRef.current = true;
            return;
        }
        /*
         * PWA-shortcut params (`openTaskCreator`, `openCopilot`) get
         * stripped by the effect above on the same render. Both effects
         * call into `setSearchParams` on mount; the PWA strip uses a
         * non-functional setter and mine uses a functional one. React
         * Router applies them sequentially, but if mine fires before
         * the PWA strip lands, my functional `prev` still sees the
         * shortcut param and merges it into the next URL — the test
         * harness then observes `?openTaskCreator=1&sort=createdAt-desc`
         * instead of just `?sort=createdAt-desc`. Defer to the NEXT
         * render in that case so the PWA strip has cleared the URL by
         * the time we apply defaults.
         */
        const hasShortcutParam =
            shortcutSearchParams.get("openTaskCreator") === "1" ||
            shortcutSearchParams.get("openCopilot") === "1";
        if (hasShortcutParam) return;
        defaultsAppliedRef.current = true;
        /*
         * Phase 4.2 review follow-up — only write defaults into the URL
         * when the user has explicitly saved one. Without this guard
         * every fresh mount with no saved default would push the
         * fallback `sort=createdAt-desc` into the URL, polluting the
         * address bar for users who never opted in. When `savedDefaults`
         * is null the list still renders correctly: `narrowSort` (and
         * the rest of the page) falls through to the same
         * `PROJECT_LIST_DEFAULTS_FALLBACK` baseline, the URL just stays
         * clean.
         */
        if (savedProjectListDefaults === null) return;
        setParam({
            sort: savedProjectListDefaults.sort,
            managerId: savedProjectListDefaults.managerId ?? "",
            favoritedOnly: savedProjectListDefaults.favoritedOnly ? "1" : ""
        });
        // Re-run when the shortcut params change so the deferred branch
        // above eventually fires on the post-strip render. The
        // `defaultsAppliedRef` guard keeps the write to a single
        // dispatch across the page's lifetime. `param`, `setParam`,
        // and `savedProjectListDefaults` are intentionally omitted:
        // adding them would re-fire the effect on every user filter
        // tweak (and on the save-default click that mutates the slice
        // from inside the panel), racing the PWA-shortcut strip
        // documented above. The one-shot contract is enforced by the
        // ref guard, not by the dep array — this is a load-bearing
        // dep-array omission, not an oversight. The repo doesn't have
        // `react-hooks/exhaustive-deps` enabled today so a disable
        // comment would dangle; we rely on this comment block to keep
        // future maintainers from "fixing" the deps.
    }, [shortcutSearchParams]);
    /*
     * Only the API-triggering params (projectName, managerId) are debounced;
     * the client-side semanticIds filter applies immediately so users see
     * keystroke-rate feedback. 300 ms is the sweet spot between perceived
     * snappiness and avoiding a request per keystroke.
     */
    const debouncedParam = useDebounce(param, 300);
    const { projectName, managerId } = debouncedParam;
    const fetchParam = { projectName, managerId };
    const { user } = useAuth();
    const favoritedOnly = Boolean(param.favoritedOnly);
    const sortOrder = narrowSort(param.sort, projectListDefaults.sort);
    const setSortOrder = (next: ProjectListSort) => setParam({ sort: next });
    const {
        isLoading: pLoading,
        error: pError,
        data: projects,
        refetch: refetchProjects,
        isRefetching: projectsRefetching
    } = useReactQuery<IProject[]>("projects", fetchParam);
    const {
        isLoading: mLoading,
        error: mError,
        data: members,
        refetch: refetchMembers
    } = useMembersList();

    const stats = useMemo(() => {
        const total = projects?.length ?? 0;
        const liked = (projects ?? []).filter((p) =>
            (members ?? []).some((m) => m._id === p.managerId)
        ).length;
        const orgs = new Set(
            (projects ?? []).map((p) => p.organization).filter(Boolean)
        ).size;
        return { total, withManager: liked, organizations: orgs };
    }, [projects, members]);

    /**
     * Live-region announcement for the three stat cards. While the
     * query is in flight, screen-reader users hear "Loading project
     * stats"; once both queries resolve, the resolved counts replace
     * the loading text (aria-atomic re-reads the whole block as one
     * sentence). Replaces the previous `aria-hidden={pLoading}` on the
     * StatRail, which blanked the stats from AT during load and never
     * re-announced them when they returned. (QW-14.)
     */
    const statsBusy = pLoading || mLoading;
    const statsAnnouncement = statsBusy
        ? microcopy.projectsPage.loadingStats
        : microcopy.projectsPage.statsAnnouncement
              .replace(
                  "{projects}",
                  pluralCount(microcopy.projectsPage.statsProjects, stats.total)
              )
              .replace(
                  "{organizations}",
                  pluralCount(
                      microcopy.projectsPage.statsOrganizations,
                      stats.organizations
                  )
              )
              .replace(
                  "{members}",
                  pluralCount(
                      microcopy.projectsPage.statsMembers,
                      members?.length ?? 0
                  )
              );

    const filteredProjects = useMemo(() => {
        const semanticPool = param.semanticIds
            ? (projects ?? []).filter((p) =>
                  param.semanticIds!.split(",").filter(Boolean).includes(p._id)
              )
            : (projects ?? []);
        if (!favoritedOnly) return semanticPool;
        const liked = new Set(user?.likedProjects ?? []);
        return semanticPool.filter((p) => liked.has(p._id));
    }, [favoritedOnly, param.semanticIds, projects, user?.likedProjects]);

    /*
     * Phase 4.2 — saved-default handlers passed to the search panel.
     * "Save as default" persists the CURRENT filter + sort state to the
     * `userPreferences` slice; "Reset to default" rewrites the URL
     * back to the saved default (or the fallback) without touching
     * `semanticIds`, which is the AI-search slot owned by a different
     * code path.
     */
    const handleSaveDefault = () => {
        saveProjectListDefaults({
            sort: sortOrder,
            managerId: param.managerId || null,
            favoritedOnly
        });
    };
    const handleResetToDefault = () => {
        setParam({
            sort: projectListDefaults.sort,
            managerId: projectListDefaults.managerId ?? "",
            favoritedOnly: projectListDefaults.favoritedOnly ? "1" : "",
            // Clear the free-text search and any in-flight semantic
            // filter — "Reset to default" is a stronger version of
            // "Clear all" that also re-establishes the saved sort /
            // favorited toggle, so the projectName + semanticIds
            // values get dropped along with the explicit filters.
            projectName: "",
            semanticIds: ""
        });
    };

    /*
     * Phone pull-to-refresh (Wave 6). Re-fetches both the project list
     * and the member roster so the stat rail + list reflect server state.
     * `PullToRefresh` awaits this promise to time the spinner; it is a
     * transparent passthrough on desktop, so desktop refreshes through the
     * error-retry Alert exactly as before.
     */
    const handleRefresh = () =>
        Promise.all([refetchProjects(), refetchMembers()]);

    const projectSearchPanel = (
        <ProjectSearchPanel
            favoritedOnly={favoritedOnly}
            hasSavedDefaults={savedProjectListDefaults !== null}
            loading={mLoading}
            members={members ?? []}
            onClearSavedDefault={clearProjectListDefaults}
            onFavoritedOnlyChange={(next) =>
                setParam({ favoritedOnly: next ? "1" : "" })
            }
            onResetToDefault={handleResetToDefault}
            onSaveDefault={handleSaveDefault}
            param={param}
            setParam={setParam}
            aiSearchSlot={
                aiEnabled ? (
                    <div
                        style={{
                            flexBasis: "100%",
                            marginBottom: space.sm
                        }}
                    >
                        <AiSearchInput
                            kind="projects"
                            projectsContext={{
                                projects: projects ?? [],
                                members: members ?? []
                            }}
                            semanticIds={param.semanticIds}
                            setSemanticIds={(value) =>
                                setParam({ semanticIds: value })
                            }
                        />
                    </div>
                ) : undefined
            }
        />
    );

    const projectsErrorAlert =
        pError || mError ? (
            <Alert variant="destructive" style={{ marginBottom: space.sm }}>
                <CircleAlert aria-hidden />
                <AlertTitle>{microcopy.feedback.loadFailed}</AlertTitle>
                <AlertDescription>
                    {microcopy.feedback.retryHint}
                </AlertDescription>
                <div style={{ marginTop: space.sm }}>
                    <Button
                        onClick={() => {
                            if (pError) refetchProjects();
                            if (mError) refetchMembers();
                        }}
                        size="sm"
                        variant="primary"
                    >
                        {microcopy.actions.retry}
                    </Button>
                </div>
            </Alert>
        ) : null;

    const projectList = (
        <ProjectList
            dataSource={filteredProjects}
            error={Boolean(pError || mError)}
            loading={pLoading || mLoading}
            members={members ?? []}
            onSortOrderChange={setSortOrder}
            sortOrder={sortOrder}
        />
    );

    return (
        <PageContainer>
            <PullToRefresh
                data-testid="projects-pull-to-refresh"
                onRefresh={handleRefresh}
                refreshing={projectsRefetching}
            >
                <header className={PAGE_HEADER_CLASS}>
                    <div className={PAGE_HEADING_GROUP_CLASS}>
                        <Typography.Title
                            className={PAGE_HEADING_CLASS}
                            level={1}
                        >
                            {microcopy.projectsPage.title}
                        </Typography.Title>
                        <p className={PAGE_SUBHEADING_CLASS}>
                            {microcopy.projectsPage.subtitle}
                        </p>
                    </div>
                    <div className={TOOLBAR_CLASS}>
                        {aiEnabled &&
                            environment.copilotDockEnabled &&
                            !isPhone && (
                                <div
                                    aria-label={copilotUnreadAriaLabel}
                                    className="relative inline-flex"
                                    data-testid="copilot-launcher-badge"
                                >
                                    <Button
                                        aria-label={microcopy.ai.askCopilot}
                                        onClick={() => openChatDrawer()}
                                        variant="default"
                                    >
                                        <AiSparkleIcon aria-hidden />
                                        {microcopy.labels.askShort}
                                    </Button>
                                    {copilotInboxUnread > 0 ? (
                                        <span
                                            aria-hidden
                                            className="pointer-events-none absolute -right-xxs -top-xxs inline-flex min-w-4 items-center justify-center rounded-pill bg-destructive px-[4px] text-[10px] font-semibold leading-4 text-destructive-foreground"
                                        >
                                            {copilotInboxUnread > 99
                                                ? "99+"
                                                : copilotInboxUnread}
                                        </span>
                                    ) : null}
                                </div>
                            )}
                        <Button
                            aria-label={microcopy.actions.createProject}
                            onClick={openModal}
                            variant="primary"
                        >
                            <Plus aria-hidden />
                            {microcopy.actions.createProject}
                        </Button>
                    </div>
                </header>
                <Typography.Text
                    className={COMPACT_STATS_LINE_CLASS}
                    type="secondary"
                >
                    {statsAnnouncement}
                </Typography.Text>
                {/*
                 * Stat rail — hidden for small workspaces where the counts
                 * duplicate what the list already shows. Keeps the sr-only
                 * announcement for AT; the visual cards only appear once the
                 * workspace is large enough to benefit from the summary.
                 */}
                {statsBusy || stats.total >= 8 ? (
                    <div className={STAT_RAIL_CLASS} aria-busy={statsBusy}>
                        <div className={STAT_CARD_CLASS}>
                            <div className={STAT_HEADER_CLASS}>
                                <span
                                    className={STAT_ICON_CLASS}
                                    style={{ background: accent.bgSubtle }}
                                    aria-hidden
                                >
                                    <LayoutGrid />
                                </span>
                                <span className={STAT_LABEL_CLASS}>
                                    {microcopy.projectsPage.totalProjects}
                                </span>
                            </div>
                            <span className={STAT_VALUE_CLASS}>
                                {pLoading ? "—" : stats.total}
                            </span>
                        </div>
                        <div className={STAT_CARD_CLASS}>
                            <div className={STAT_HEADER_CLASS}>
                                <span
                                    className={STAT_ICON_CLASS}
                                    style={{ background: accent.bgSubtle }}
                                    aria-hidden
                                >
                                    <Building2 />
                                </span>
                                <span className={STAT_LABEL_CLASS}>
                                    {microcopy.projectsPage.organizations}
                                </span>
                            </div>
                            <span className={STAT_VALUE_CLASS}>
                                {pLoading ? "—" : stats.organizations}
                            </span>
                        </div>
                        <div className={STAT_CARD_CLASS}>
                            <div className={STAT_HEADER_CLASS}>
                                <span
                                    className={STAT_ICON_CLASS}
                                    style={{ background: accent.bgSubtle }}
                                    aria-hidden
                                >
                                    <Users />
                                </span>
                                <span className={STAT_LABEL_CLASS}>
                                    {microcopy.projectsPage.teamMembers}
                                </span>
                            </div>
                            <span className={STAT_VALUE_CLASS}>
                                {mLoading ? "—" : (members?.length ?? 0)}
                            </span>
                        </div>
                    </div>
                ) : null}
                <SrOnlyLive>{statsAnnouncement}</SrOnlyLive>
                <div className={MOBILE_FIRST_SECTION_CLASS}>
                    {isPhone ? (
                        <>
                            {projectSearchPanel}
                            {projectsErrorAlert}
                            {projectList}
                        </>
                    ) : null}
                </div>
                <div className={DESKTOP_FIRST_SECTION_CLASS}>
                    {!isPhone ? projectSearchPanel : null}
                    {!isPhone ? projectsErrorAlert : null}
                    {!isPhone ? projectList : null}
                </div>
                {/*
                 * The Copilot chat surface is the tabbed `<CopilotDock>`
                 * mounted once by `CopilotDockHost` inside `MainLayout`; it
                 * survives the /projects → board navigation and consumes any
                 * pending prompt through the bridge. The project list only
                 * triggers it via the launcher + PWA-shortcut callsites
                 * above — it mounts no AI drawer of its own.
                 */}
            </PullToRefresh>
        </PageContainer>
    );
};

export default ProjectPage;
