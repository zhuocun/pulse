import styled from "@emotion/styled";
import { Alert, Button, Card, message, Select, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import { PageSpin } from "../components/status";
import { microcopy } from "../constants/microcopy";
import {
    breakpoints,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    radius,
    space
} from "../theme/tokens";
import useAuth from "../utils/hooks/useAuth";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";
import useShareTargetParams from "../utils/hooks/useShareTargetParams";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";
import newTaskCallback from "../utils/optimisticUpdate/createTask";

/*
 * Web Share Target landing page (Phase 3 A4).
 *
 * Wired to the manifest entry:
 *
 *     "share_target": {
 *         "action": "/share",
 *         "method": "GET",
 *         "enctype": "application/x-www-form-urlencoded",
 *         "params": { "title": "title", "text": "text", "url": "url" }
 *     }
 *
 * Browsers send the share-target payload as URL search params on a
 * standard GET navigation. Only platforms that support the spec
 * surface a Pulse entry in their native share sheet — at the time of
 * writing that's Android Chrome and Edge. iOS Safari does not yet
 * support `share_target`, so the page is effectively a no-op there.
 * A user could still land on `/share` manually (e.g. paste the URL),
 * which we handle gracefully: with no params we render an empty
 * "nothing to share" surface, and with no projects we route them to
 * the project list to create one first.
 *
 * The POST variant of the manifest spec also exists but would require
 * the Service Worker to intercept the request body and stash it in a
 * client-readable cache — more infrastructure than the current PWA
 * scope justifies. GET (URL-encoded) is the simplest contract and
 * already covers ~95 % of share intents (text, title, URL).
 */

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
    margin: ${space.xxs}px 0 ${space.lg}px;
    max-width: 56ch;
`;

const SummaryCard = styled(Card)`
    && {
        border-radius: ${radius.lg}px;
        margin-bottom: ${space.lg}px;
    }
`;

const SummaryLabel = styled.div`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    letter-spacing: ${letterSpacing.wide};
    margin-bottom: ${space.xxs}px;
    text-transform: uppercase;
`;

const SummaryValue = styled.div`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    font-size: ${fontSize.base}px;
    line-height: ${lineHeight.normal};
    overflow-wrap: anywhere;
`;

const SummarySection = styled.div`
    & + & {
        margin-top: ${space.sm}px;
    }
`;

const FormCard = styled(Card)`
    && {
        border-radius: ${radius.lg}px;
    }
`;

const FieldLabel = styled.label`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    display: block;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
    margin-bottom: ${space.xxs}px;
`;

const FieldRow = styled.div`
    & + & {
        margin-top: ${space.md}px;
    }
`;

const ActionsRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
    justify-content: flex-end;
    margin-top: ${space.lg}px;
`;

/**
 * Build the task name from the share payload. Prefers the explicit
 * `title`, falls back to a trimmed prefix of the shared `text`, and
 * finally to the `url`'s host so we always have a non-empty label
 * for the resulting task. Mirrors what a user would type by hand.
 */
const deriveTaskName = (params: {
    title?: string;
    text?: string;
    url?: string;
}): string => {
    const title = params.title?.trim();
    if (title) return title;
    const text = params.text?.trim();
    if (text) {
        // Keep the name short; the full text still goes into the note.
        return text.length > 80 ? `${text.slice(0, 80).trimEnd()}…` : text;
    }
    const url = params.url?.trim();
    if (url) {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
    return "";
};

/**
 * Compose the task note from the shared text + url. Each line is
 * preserved verbatim so the user can edit out whichever they don't
 * need. Returns `undefined` when both are empty so we don't ship a
 * blank-line note (the task-creation endpoint treats undefined as
 * "no note" — see `utils/optimisticUpdate/createTask.ts`).
 *
 * The URL is appended only when it's not already a substring of the
 * shared text. Android Chrome routinely packs the same URL into both
 * the `text` field (as the trailing portion of the shared snippet)
 * AND the `url` field; an exact-equality check failed to catch that
 * and the URL ended up rendered twice. Substring check covers both
 * the exact-match case and the embedded-in-text case.
 */
const composeNote = (params: {
    text?: string;
    url?: string;
}): string | undefined => {
    const segments: string[] = [];
    const text = params.text?.trim();
    if (text) segments.push(text);
    const url = params.url?.trim();
    if (url && !text?.includes(url)) segments.push(url);
    return segments.length > 0 ? segments.join("\n\n") : undefined;
};

const SharePage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.share));
    const navigate = useNavigate();
    const { user } = useAuth();
    const params = useShareTargetParams();

    /*
     * Default task name derives from the share payload but the user
     * may want to tweak it before posting. We seed local state from
     * the derived value and keep it editable via the input field.
     */
    const derivedName = useMemo(() => deriveTaskName(params), [params]);
    const [taskName, setTaskName] = useState(derivedName);
    useEffect(() => {
        // Re-seed when the share params change (e.g. user re-shared).
        setTaskName(derivedName);
    }, [derivedName]);

    const note = useMemo(() => composeNote(params), [params]);

    const { data: projects, isLoading: projectsLoading } =
        useReactQuery<IProject[]>("projects");

    const [selectedProjectId, setSelectedProjectId] = useState<
        string | undefined
    >();
    useEffect(() => {
        // Default to the first project once the list resolves so the
        // user can submit without an extra interaction. They can still
        // pick a different one from the dropdown.
        if (
            selectedProjectId === undefined &&
            projects &&
            projects.length > 0
        ) {
            setSelectedProjectId(projects[0]?._id);
        }
    }, [projects, selectedProjectId]);

    const { data: columns, isLoading: columnsLoading } = useReactQuery<
        IColumn[]
    >(
        "boards",
        { projectId: selectedProjectId },
        undefined,
        undefined,
        undefined,
        Boolean(selectedProjectId)
    );

    const [selectedColumnId, setSelectedColumnId] = useState<
        string | undefined
    >();
    useEffect(() => {
        // Default to the project's first column. Resetting the selection
        // whenever the project changes prevents a stale column from a
        // previously picked board sticking around in the input.
        if (columns && columns.length > 0) {
            setSelectedColumnId((current) =>
                current && columns.some((c) => c._id === current)
                    ? current
                    : columns[0]?._id
            );
        } else if (!columnsLoading) {
            setSelectedColumnId(undefined);
        }
    }, [columns, columnsLoading]);

    const { mutateAsync, isLoading: submitting } = useReactMutation(
        "tasks",
        "POST",
        ["tasks", { projectId: selectedProjectId }],
        newTaskCallback
    );

    const projectOptions = useMemo(
        () =>
            (projects ?? []).map((p) => ({
                label: p.projectName,
                value: p._id
            })),
        [projects]
    );
    const columnOptions = useMemo(
        () =>
            (columns ?? []).map((c) => ({
                label: c.columnName,
                value: c._id
            })),
        [columns]
    );

    const canSubmit =
        !submitting &&
        Boolean(selectedProjectId) &&
        Boolean(selectedColumnId) &&
        taskName.trim().length > 0;

    const onCreate = async () => {
        if (!canSubmit || !selectedProjectId || !selectedColumnId) return;
        await mutateAsync({
            taskName: taskName.trim(),
            projectId: selectedProjectId,
            columnId: selectedColumnId,
            coordinatorId: user?._id,
            note
        });
        message.success(microcopy.feedback.taskSaved);
        navigate(`/projects/${selectedProjectId}/board`, {
            viewTransition: true
        });
    };

    const onCancel = () => {
        navigate("/projects", { viewTransition: true });
    };

    if (projectsLoading) {
        return (
            <PageContainer>
                <PageSpin />
            </PageContainer>
        );
    }

    if (!projects || projects.length === 0) {
        return (
            <PageContainer>
                <EmptyState
                    variant="projects"
                    headingLevel={1}
                    title={microcopy.share.emptyTitle}
                    description={microcopy.share.emptyDescription}
                    cta={
                        <Button
                            onClick={() =>
                                navigate("/projects", {
                                    viewTransition: true
                                })
                            }
                            type="primary"
                        >
                            {microcopy.actions.createProject}
                        </Button>
                    }
                />
            </PageContainer>
        );
    }

    const hasPayload =
        Boolean(params.title) || Boolean(params.text) || Boolean(params.url);

    return (
        <PageContainer>
            <header>
                <PageHeading level={1}>{microcopy.share.headline}</PageHeading>
                <PageSubheading>{microcopy.share.summary}</PageSubheading>
            </header>

            {hasPayload ? (
                <SummaryCard
                    aria-label={microcopy.share.headline}
                    data-testid="share-summary"
                    variant="outlined"
                >
                    {params.title ? (
                        <SummarySection>
                            <SummaryLabel>
                                {microcopy.share.summaryTitle}
                            </SummaryLabel>
                            <SummaryValue>{params.title}</SummaryValue>
                        </SummarySection>
                    ) : null}
                    {params.text ? (
                        <SummarySection>
                            <SummaryLabel>
                                {microcopy.share.summaryText}
                            </SummaryLabel>
                            <SummaryValue>{params.text}</SummaryValue>
                        </SummarySection>
                    ) : null}
                    {params.url ? (
                        <SummarySection>
                            <SummaryLabel>
                                {microcopy.share.summaryUrl}
                            </SummaryLabel>
                            <SummaryValue>{params.url}</SummaryValue>
                        </SummarySection>
                    ) : null}
                </SummaryCard>
            ) : (
                <Alert
                    data-testid="share-nothing"
                    description={microcopy.share.nothingDescription}
                    showIcon
                    style={{ marginBottom: space.lg }}
                    title={microcopy.share.nothingTitle}
                    type="info"
                />
            )}

            <FormCard variant="outlined">
                <FieldRow>
                    <FieldLabel htmlFor="share-task-name">
                        {microcopy.fields.taskName}
                    </FieldLabel>
                    <input
                        aria-label={microcopy.fields.taskName}
                        className="ant-input"
                        id="share-task-name"
                        onChange={(e) => setTaskName(e.target.value)}
                        type="text"
                        value={taskName}
                        style={{
                            borderRadius: radius.md,
                            padding: `${space.xs}px ${space.sm}px`,
                            width: "100%"
                        }}
                    />
                </FieldRow>

                <FieldRow>
                    <FieldLabel htmlFor="share-project">
                        {microcopy.share.projectLabel}
                    </FieldLabel>
                    <Select
                        aria-label={microcopy.share.projectLabel}
                        id="share-project"
                        loading={projectsLoading}
                        onChange={(value) => setSelectedProjectId(value)}
                        options={projectOptions}
                        style={{ width: "100%" }}
                        value={selectedProjectId}
                    />
                </FieldRow>

                <FieldRow>
                    <FieldLabel htmlFor="share-column">
                        {microcopy.share.columnLabel}
                    </FieldLabel>
                    <Select
                        aria-label={microcopy.share.columnLabel}
                        id="share-column"
                        loading={columnsLoading}
                        onChange={(value) => setSelectedColumnId(value)}
                        options={columnOptions}
                        style={{ width: "100%" }}
                        value={selectedColumnId}
                    />
                </FieldRow>

                <ActionsRow>
                    <Space>
                        <Button onClick={onCancel}>
                            {microcopy.share.cancel}
                        </Button>
                        <Button
                            disabled={!canSubmit}
                            loading={submitting}
                            onClick={onCreate}
                            type="primary"
                        >
                            {microcopy.share.create}
                        </Button>
                    </Space>
                </ActionsRow>
            </FormCard>
        </PageContainer>
    );
};

export default SharePage;
