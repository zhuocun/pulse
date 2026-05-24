import {
    AppstoreOutlined,
    BankOutlined,
    PlusOutlined,
    TeamOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Alert, Badge, Button, Typography } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import AiChatDrawer from "../components/aiChatDrawer";
import AiSearchInput from "../components/aiSearchInput";
import AiSparkleIcon from "../components/aiSparkleIcon";
import PageContainer from "../components/pageContainer";
import ProjectList from "../components/projectList";
import ProjectSearchPanel from "../components/projectSearchPanel";
import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";
import type { ProjectListSort } from "../store/reducers/userPreferencesSlice";
import {
    accent,
    breakpoints,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    radius,
    space
} from "../theme/tokens";
import SrOnlyLive from "../utils/a11y/SrOnlyLive";
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useCopilotDock from "../utils/hooks/useCopilotDock";
import useDebounce from "../utils/hooks/useDebounce";
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

const PageHeader = styled.header`
    align-items: flex-end;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.sm}px;
    justify-content: space-between;
    margin-bottom: ${space.lg}px;
    row-gap: ${space.xs}px;

    @media (min-width: ${breakpoints.md}px) {
        margin-bottom: ${space.xl}px;
    }
`;

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xl}px;
        font-weight: ${fontWeight.semibold};
        letter-spacing: ${letterSpacing.tight};
        line-height: ${lineHeight.tight};
        margin: 0;
        min-width: 0;
    }

    @media (min-width: ${breakpoints.md}px) {
        && {
            font-size: ${fontSize.xxl}px;
        }
    }
`;

const PageSubheading = styled.p`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.base}px;
    line-height: ${lineHeight.normal};
    margin: ${space.xxs}px 0 0;
    max-width: 56ch;
`;

const PageHeadingGroup = styled.div`
    flex: 1 1 auto;
    min-width: 0;
`;

const Toolbar = styled.div`
    align-items: center;
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: ${space.xs}px;

    @media (max-width: ${breakpoints.sm - 1}px) {
        flex-basis: 100%;
        > .ant-btn {
            flex: 1 1 0;
        }
    }
`;

const StatRail = styled.div`
    display: grid;
    gap: ${space.xs}px;
    /*
     * On the narrowest viewports (≤ 360 px) three columns leave each card
     * around 95 px, which crowds the labels and clips the values. Drop to a
     * single horizontal row of three smaller cards instead, then expand to
     * three full columns at sm+. The grid-template-columns at base width
     * uses minmax(0, 1fr) so labels stay fully visible on every Android
     * width down to 320 px.
     */
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: ${space.md}px;

    @media (min-width: ${breakpoints.sm}px) {
        gap: ${space.sm}px;
        margin-bottom: ${space.lg}px;
    }
`;

const StatCard = styled.div`
    align-items: flex-start;
    background: var(--ant-color-bg-container, #fff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.lg}px;
    display: flex;
    flex-direction: column;
    gap: ${space.xxs / 2}px;
    min-width: 0;
    padding: ${space.xs}px ${space.sm}px;
    position: relative;

    /*
     * Centre everything on phone-sized viewports — the StatHeader stacks
     * its icon over the label there, so a left-aligned value would float
     * awkwardly off-axis from the now-centred header.
     */
    @media (max-width: ${breakpoints.sm - 1}px) {
        align-items: center;
        gap: ${space.xxs}px;
        text-align: center;
    }

    @media (min-width: ${breakpoints.sm}px) {
        gap: ${space.xxs}px;
        padding: ${space.md}px ${space.lg}px;
    }
`;

const StatHeader = styled.div`
    align-items: center;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.55));
    display: flex;
    gap: ${space.xs}px;
    min-width: 0;
    width: 100%;

    /*
     * Stack the icon above the label on phone-sized viewports so the
     * label claims the full card width (~80–100 px) instead of sharing
     * it with the icon + gap (which left ~55 px and forced
     * "ORGANIZATIONS" to break mid-word as "ORGANIZATI / ONS"). On sm+
     * the inline row returns since the cards are wide enough.
     */
    @media (max-width: ${breakpoints.sm - 1}px) {
        flex-direction: column;
        gap: ${space.xxs}px;
    }
`;

const StatIcon = styled.span`
    align-items: center;
    background: ${accent.bgSubtle};
    border-radius: ${radius.sm}px;
    color: var(--ant-color-primary, #ea580c);
    display: inline-flex;
    flex: 0 0 auto;
    height: 24px;
    justify-content: center;
    width: 24px;

    /* Icon-glyph stays compact; the surrounding pill carries the colour. */
    svg {
        font-size: 14px;
    }

    @media (max-width: ${breakpoints.sm - 1}px) {
        height: 20px;
        width: 20px;

        svg {
            font-size: 12px;
        }
    }
`;

const StatLabel = styled.span`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.55));
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    letter-spacing: ${letterSpacing.wide};
    /* The card uses align-items: flex-start (so values don't stretch),
     * which sizes children to their content on the cross axis. Without
     * this cap, "TEAM MEMBERS" sizes to its 103 px max-content and
     * spills past the card on narrow viewports — the
     * text-overflow: ellipsis below only fires when the element is
     * actually narrower than its content. */
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;

    /* Below sm (480 px) three columns leave ~80–100 px per card. With
     * the icon stacked above (see StatHeader) the label gets the whole
     * card width. Drop the wide tracking, shrink the size a notch, and
     * use word-break: keep-all + white-space: normal so two-word
     * labels wrap at their space ("TEAM" / "MEMBERS") and the
     * single-token "ORGANIZATIONS" stays on one line instead of
     * splitting mid-character ("ORGANIZATI / ONS"). The clamp scales the
     * font down to 10 px on iPhone-SE-class viewports (≤ 360 px wide)
     * so even the longest label fits. */
    @media (max-width: ${breakpoints.sm - 1}px) {
        font-size: clamp(10px, 2.9vw, 11px);
        letter-spacing: ${letterSpacing.normal};
        line-height: ${lineHeight.tight};
        text-align: center;
        white-space: normal;
        word-break: keep-all;
    }
`;

const StatValue = styled.span`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: ${letterSpacing.tight};

    @media (min-width: ${breakpoints.sm}px) {
        font-size: ${fontSize.xl}px;
    }
`;

const ProjectPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.projects), false);
    const { openModal } = useProjectModal();
    const { enabled: aiEnabled } = useAiEnabled();
    const {
        open: chatOpen,
        openDrawer: openChatDrawer,
        closeDrawer: closeChatDrawer,
        pendingPrompt: chatInitialPrompt
    } = useAiChatDrawer();
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
    /**
     * Listen for `boardCopilot:openChat` from the command palette so the
     * project list (no board context) still surfaces AI mode submissions
     * (PRD CP-R6).
     *
     * R-A M1 Issue #2: under the dock flag, the host owns the listener
     * so palette → dock works from any route. Keeping this listener
     * live under the flag would dispatch `openChatDrawer` twice and
     * cause Issue #4 (the project-page-mounted `<AiChatDrawer>` also
     * consumes the prompt, then the dock body consumes it AGAIN after
     * navigation to the board).
     */
    useEffect(() => {
        if (environment.copilotDockEnabled) return;
        if (!aiEnabled) return;
        const onOpenChat = (event: Event) => {
            const detail = (event as CustomEvent<{ prompt?: string }>).detail;
            openChatDrawer(detail?.prompt);
        };
        window.addEventListener("boardCopilot:openChat", onOpenChat);
        return () =>
            window.removeEventListener("boardCopilot:openChat", onOpenChat);
    }, [aiEnabled, openChatDrawer]);
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
        // actual behavior. `openCopilot` opens the legacy AI chat drawer
        // mounted below (the CopilotDock lives only on board.tsx).
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
        refetch: refetchProjects
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
              .replace("{total}", String(stats.total))
              .replace("{organizations}", String(stats.organizations))
              .replace("{members}", String(members?.length ?? 0));

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

    return (
        <PageContainer>
            <PageHeader>
                <PageHeadingGroup>
                    <PageHeading level={1}>
                        {microcopy.projectsPage.title}
                    </PageHeading>
                    <PageSubheading>
                        {microcopy.projectsPage.subtitle}
                    </PageSubheading>
                </PageHeadingGroup>
                <Toolbar>
                    {aiEnabled && (
                        <Badge
                            aria-label={copilotUnreadAriaLabel}
                            count={copilotInboxUnread}
                            data-testid="copilot-launcher-badge"
                            offset={[-4, 4]}
                            size="small"
                        >
                            <Button
                                aria-label={microcopy.ai.askCopilot}
                                icon={<AiSparkleIcon aria-hidden />}
                                onClick={() => openChatDrawer()}
                                type="default"
                            >
                                {microcopy.labels.askShort}
                            </Button>
                        </Badge>
                    )}
                    <Button
                        aria-label={microcopy.actions.createProject}
                        icon={<PlusOutlined aria-hidden />}
                        onClick={openModal}
                        type="primary"
                    >
                        {microcopy.actions.createProject}
                    </Button>
                </Toolbar>
            </PageHeader>
            {/*
             * Stat rail. `aria-busy` (was previously `aria-hidden`) lets
             * the region stay in the AT tree during load — the visible
             * cards still announce, but the polite live region below
             * narrates the "loading" → "resolved counts" transition so
             * SR users get a single sentence about the page instead of
             * three separate stats. (QW-14.)
             */}
            <StatRail aria-busy={statsBusy}>
                <StatCard>
                    <StatHeader>
                        <StatIcon aria-hidden>
                            <AppstoreOutlined />
                        </StatIcon>
                        <StatLabel>
                            {microcopy.projectsPage.totalProjects}
                        </StatLabel>
                    </StatHeader>
                    <StatValue>{pLoading ? "—" : stats.total}</StatValue>
                </StatCard>
                <StatCard>
                    <StatHeader>
                        <StatIcon aria-hidden>
                            <BankOutlined />
                        </StatIcon>
                        <StatLabel>
                            {microcopy.projectsPage.organizations}
                        </StatLabel>
                    </StatHeader>
                    <StatValue>
                        {pLoading ? "—" : stats.organizations}
                    </StatValue>
                </StatCard>
                <StatCard>
                    <StatHeader>
                        <StatIcon aria-hidden>
                            <TeamOutlined />
                        </StatIcon>
                        <StatLabel>
                            {microcopy.projectsPage.teamMembers}
                        </StatLabel>
                    </StatHeader>
                    <StatValue>
                        {mLoading ? "—" : (members?.length ?? 0)}
                    </StatValue>
                </StatCard>
            </StatRail>
            <SrOnlyLive>{statsAnnouncement}</SrOnlyLive>
            <ProjectSearchPanel
                param={param}
                setParam={setParam}
                members={members ?? []}
                loading={mLoading}
                favoritedOnly={favoritedOnly}
                onFavoritedOnlyChange={(next) =>
                    setParam({ favoritedOnly: next ? "1" : "" })
                }
                hasSavedDefaults={savedProjectListDefaults !== null}
                onSaveDefault={handleSaveDefault}
                onResetToDefault={handleResetToDefault}
                onClearSavedDefault={clearProjectListDefaults}
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
            {pError || mError ? (
                <Alert
                    action={
                        <Button
                            onClick={() => {
                                if (pError) refetchProjects();
                                if (mError) refetchMembers();
                            }}
                            size="small"
                            type="primary"
                        >
                            {microcopy.actions.retry}
                        </Button>
                    }
                    description={microcopy.feedback.retryHint}
                    showIcon
                    style={{ marginBottom: space.sm }}
                    title={microcopy.feedback.loadFailed}
                    type="error"
                />
            ) : null}
            <ProjectList
                dataSource={filteredProjects}
                error={Boolean(pError || mError)}
                members={members ?? []}
                loading={pLoading || mLoading}
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrder}
            />
            {aiEnabled && !environment.copilotDockEnabled && (
                /*
                 * R-A M1 Issue #4: when the dock flag is on, the host
                 * mounts a single CopilotDock surface that survives
                 * navigations and consumes any pending prompt through
                 * the bridge. Keeping this drawer mounted alongside
                 * caused the prompt to be dispatched TWICE: once by
                 * this drawer's ChatTabBody on /projects, then again
                 * by the host's ChatTabBody after the user navigated
                 * to /projects/p1/board — because the new instance
                 * still saw `chatDrawer.pendingPrompt` in Redux and
                 * its own `initialPromptHandled.current` was null.
                 */
                <AiChatDrawer
                    columns={[]}
                    initialPrompt={chatInitialPrompt}
                    knownProjectIds={(projects ?? []).map((p) => p._id)}
                    members={members ?? []}
                    onClose={closeChatDrawer}
                    open={chatOpen}
                    project={null}
                    tasks={[]}
                />
            )}
        </PageContainer>
    );
};

export default ProjectPage;
