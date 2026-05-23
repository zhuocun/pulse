import {
    AppstoreOutlined,
    BankOutlined,
    PlusOutlined,
    TeamOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Alert, Button, Typography } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import AiChatDrawer from "../components/aiChatDrawer";
import AiSearchInput from "../components/aiSearchInput";
import AiSparkleIcon from "../components/aiSparkleIcon";
import PageContainer from "../components/pageContainer";
import ProjectList from "../components/projectList";
import ProjectSearchPanel from "../components/projectSearchPanel";
import { microcopy } from "../constants/microcopy";
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
import useDebounce from "../utils/hooks/useDebounce";
import useMembersList from "../utils/hooks/useMembersList";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";
import useUrl from "../utils/hooks/useUrl";

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
    /**
     * Listen for `boardCopilot:openChat` from the command palette so the
     * project list (no board context) still surfaces AI mode submissions
     * (PRD CP-R6).
     */
    useEffect(() => {
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
        "semanticIds"
    ]);
    /*
     * Only the API-triggering params (projectName, managerId) are debounced;
     * the client-side semanticIds filter applies immediately so users see
     * keystroke-rate feedback. 300 ms is the sweet spot between perceived
     * snappiness and avoiding a request per keystroke.
     */
    const debouncedParam = useDebounce(param, 300);
    const { projectName, managerId } = debouncedParam;
    const fetchParam = { projectName, managerId };
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

    const filteredProjects = param.semanticIds
        ? (projects ?? []).filter((p) =>
              param.semanticIds!.split(",").filter(Boolean).includes(p._id)
          )
        : (projects ?? []);

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
                        <Button
                            aria-label={microcopy.ai.askCopilot}
                            icon={<AiSparkleIcon aria-hidden />}
                            onClick={() => openChatDrawer()}
                            type="default"
                        >
                            {microcopy.labels.askShort}
                        </Button>
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
            />
            {aiEnabled && (
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
