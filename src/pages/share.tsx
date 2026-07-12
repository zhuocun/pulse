import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Typography } from "@/components/ui/typography";
import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import { PageSpin } from "../components/status";
import { microcopy } from "../constants/microcopy";
import useAppMessage from "../utils/hooks/useAppMessage";
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

/**
 * Only http(s) URLs round-trip through the share UI — `javascript:`,
 * `data:`, `file:` etc. don't XSS through React's text-escaping but
 * the literal string would still be rendered to the user, who may
 * casually copy/click it. Gate every URL-derived surface on this.
 */
const isSafeShareUrl = (s: string): boolean => /^https?:/i.test(s);

const SHARE_TASK_NAME_MAX_LENGTH = 80;

const truncateFallbackTaskName = (value: string): string =>
    value.length > SHARE_TASK_NAME_MAX_LENGTH
        ? `${value.slice(0, SHARE_TASK_NAME_MAX_LENGTH).trimEnd()}…`
        : value;

/**
 * Build the task name from the share payload. Prefers the explicit
 * `title`, falls back to a trimmed prefix of the shared `text`, and
 * finally to the `url`'s host so we always have a non-empty label
 * for the resulting task. Mirrors what a user would type by hand.
 * Non-http(s) URLs are ignored so a `javascript:` payload doesn't
 * end up as the task name.
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
        return truncateFallbackTaskName(text);
    }
    const url = params.url?.trim();
    if (url && isSafeShareUrl(url)) {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
    return "";
};

/**
 * Normalise a URL-ish string for case- and trailing-slash-insensitive
 * comparison. Android Chrome routinely sends `text="Look: https://Example.com/x"`
 * plus `url="https://example.com/x/"` — case + trailing slash mismatch.
 * A raw substring check failed to dedup; this canonical form catches
 * the embedded-in-text case across mixed casing and trailing slashes.
 */
const normalizeForDedup = (s: string): string => {
    try {
        const u = new URL(s);
        return (
            u.origin +
            u.pathname.replace(/\/$/, "") +
            u.search
        ).toLowerCase();
    } catch {
        return s.toLowerCase();
    }
};

/**
 * Compose the task note from the shared text + url. Each line is
 * preserved verbatim so the user can edit out whichever they don't
 * need. Returns `undefined` when both are empty so we don't ship a
 * blank-line note (the task-creation endpoint treats undefined as
 * "no note" — see `utils/optimisticUpdate/createTask.ts`).
 *
 * The URL is appended only when it's not already represented in the
 * shared text. Comparison runs on the normalised forms so a case or
 * trailing-slash mismatch (Android Chrome's quirk) still dedups.
 */
const composeNote = (params: {
    text?: string;
    url?: string;
}): string | undefined => {
    const segments: string[] = [];
    const text = params.text?.trim();
    if (text) segments.push(text);
    const url = params.url?.trim();
    // Drop non-http(s) URLs from the composed note so a javascript:
    // / data: payload never lands in the saved task.
    if (url && isSafeShareUrl(url)) {
        const normalizedText = text ? normalizeForDedup(text) : "";
        if (!normalizedText.includes(normalizeForDedup(url))) {
            segments.push(url);
        }
    }
    return segments.length > 0 ? segments.join("\n\n") : undefined;
};

const SharePage = () => {
    // AntD v6: static `message` warns about dynamic theme;
    // `useAppMessage()` returns a theme-aware instance (with a static
    // fallback for tests that render without `<App>`).
    const message = useAppMessage();
    // `keepOnMount=false` restores the previous `document.title` on
    // unmount so the share-target page doesn't leak its title into the
    // next route. Mirrors the Phase 2 Bug 7 fix on every other branded
    // page (inbox / settings / copilotLanding / project / login).
    useTitle(composeBrandedTitle(microcopy.pageTitle.share), false);
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

    const [selectedProjectId, setSelectedProjectId] = useState("");
    useEffect(() => {
        // Default to the first project once the list resolves so the
        // user can submit without an extra interaction. They can still
        // pick a different one from the dropdown.
        if (selectedProjectId === "" && projects && projects.length > 0) {
            setSelectedProjectId(projects[0]?._id ?? "");
        }
    }, [projects, selectedProjectId]);

    const { data: columns, isLoading: columnsLoading } = useReactQuery<
        IColumn[]
    >(
        "boards",
        { projectId: selectedProjectId || undefined },
        undefined,
        undefined,
        undefined,
        Boolean(selectedProjectId)
    );

    const [selectedColumnId, setSelectedColumnId] = useState("");
    useEffect(() => {
        // Default to the project's first column. Resetting the selection
        // whenever the project changes prevents a stale column from a
        // previously picked board sticking around in the input.
        if (columns && columns.length > 0) {
            setSelectedColumnId((current) =>
                current && columns.some((c) => c._id === current)
                    ? current
                    : (columns[0]?._id ?? "")
            );
        } else if (!columnsLoading) {
            setSelectedColumnId("");
        }
    }, [columns, columnsLoading]);

    // Re-derive the invalidation key from the live `selectedProjectId`
    // so that switching projects mid-session invalidates the correct
    // ["tasks", { projectId }] cache slot on success rather than the
    // first-render snapshot.
    const tasksQueryKey = useMemo(
        () => ["tasks", { projectId: selectedProjectId }] as const,
        [selectedProjectId]
    );
    const { mutateAsync, isLoading: submitting } = useReactMutation(
        "tasks",
        "POST",
        tasksQueryKey,
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
        try {
            await mutateAsync({
                taskName: taskName.trim(),
                projectId: selectedProjectId,
                columnId: selectedColumnId,
                coordinatorId: user?._id,
                note
            });
        } catch {
            // Surface the failure: without this catch the success toast +
            // navigate ran on rejection, silently dropping the user's data.
            message.error(microcopy.feedback.saveFailed);
            return;
        }
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
                            variant="primary"
                        >
                            {microcopy.actions.createProject}
                        </Button>
                    }
                />
            </PageContainer>
        );
    }

    // A non-http(s) URL is filtered out of every user-visible surface,
    // so it doesn't count as a renderable payload — otherwise the
    // summary card would render empty when the only param is e.g.
    // url=javascript:alert(1).
    const hasPayload =
        Boolean(params.title) ||
        Boolean(params.text) ||
        Boolean(params.url && isSafeShareUrl(params.url));

    return (
        <PageContainer>
            <header>
                <Typography.Title
                    className="m-0 min-w-0 text-xl font-semibold leading-tight tracking-tight md:text-xxl"
                    level={1}
                >
                    {microcopy.share.headline}
                </Typography.Title>
                <p className="mb-lg mt-xxs max-w-[56ch] text-base leading-normal text-[color:var(--pulse-text-secondary)]">
                    {microcopy.share.summary}
                </p>
            </header>

            {hasPayload ? (
                <Card
                    aria-label={microcopy.share.headline}
                    className="mb-lg p-lg"
                    data-testid="share-summary"
                >
                    {params.title ? (
                        <div className="[&+&]:mt-sm">
                            <div className="mb-xxs text-xs font-medium text-[color:var(--pulse-text-secondary)]">
                                {microcopy.share.summaryTitle}
                            </div>
                            <div className="text-base leading-normal text-page-text [overflow-wrap:anywhere]">
                                {params.title}
                            </div>
                        </div>
                    ) : null}
                    {params.text ? (
                        <div className="[&+&]:mt-sm">
                            <div className="mb-xxs text-xs font-medium text-[color:var(--pulse-text-secondary)]">
                                {microcopy.share.summaryText}
                            </div>
                            <div className="text-base leading-normal text-page-text [overflow-wrap:anywhere]">
                                {params.text}
                            </div>
                        </div>
                    ) : null}
                    {params.url && isSafeShareUrl(params.url) ? (
                        <div className="[&+&]:mt-sm">
                            <div className="mb-xxs text-xs font-medium text-[color:var(--pulse-text-secondary)]">
                                {microcopy.share.summaryUrl}
                            </div>
                            <div className="text-base leading-normal text-page-text [overflow-wrap:anywhere]">
                                {params.url}
                            </div>
                        </div>
                    ) : null}
                </Card>
            ) : (
                <Alert
                    className="mb-lg"
                    data-testid="share-nothing"
                    variant="info"
                >
                    <Info aria-hidden />
                    <AlertTitle>{microcopy.share.nothingTitle}</AlertTitle>
                    <AlertDescription>
                        {microcopy.share.nothingDescription}
                    </AlertDescription>
                </Alert>
            )}

            <Card className="p-lg">
                <div className="[&+&]:mt-md">
                    <label
                        className="mb-xxs block text-sm font-medium text-page-text"
                        htmlFor="share-task-name"
                    >
                        {microcopy.fields.taskName}
                    </label>
                    {/*
                     * Share the primitive `<Input>` so this field picks
                     * up the same enterKeyHint / autoComplete contract
                     * (and themed focus styling) as the canonical
                     * task-name field in `taskCreator`, rather than a
                     * bare `<input>` that would feel like a third-party
                     * form drop-in instead of part of Pulse.
                     */}
                    <Input
                        aria-label={microcopy.fields.taskName}
                        autoComplete="off"
                        enterKeyHint="done"
                        id="share-task-name"
                        inputMode="text"
                        onChange={(e) => setTaskName(e.target.value)}
                        value={taskName}
                    />
                </div>

                <div className="[&+&]:mt-md">
                    <label
                        className="mb-xxs block text-sm font-medium text-page-text"
                        htmlFor="share-project"
                    >
                        {microcopy.share.projectLabel}
                    </label>
                    <Select
                        onValueChange={(value) => {
                            setSelectedProjectId(value);
                            setSelectedColumnId("");
                        }}
                        value={selectedProjectId}
                    >
                        <SelectTrigger
                            aria-label={microcopy.share.projectLabel}
                            id="share-project"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {projectOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="[&+&]:mt-md">
                    <label
                        className="mb-xxs block text-sm font-medium text-page-text"
                        htmlFor="share-column"
                    >
                        {microcopy.share.columnLabel}
                    </label>
                    <Select
                        onValueChange={(value) => setSelectedColumnId(value)}
                        value={selectedColumnId}
                    >
                        <SelectTrigger
                            aria-label={microcopy.share.columnLabel}
                            id="share-column"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {columnOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="mt-lg flex flex-wrap justify-end gap-xs">
                    <Button onClick={onCancel}>
                        {microcopy.actions.cancel}
                    </Button>
                    <Button
                        disabled={!canSubmit}
                        loading={submitting}
                        onClick={onCreate}
                        variant="primary"
                    >
                        {microcopy.actions.createTask}
                    </Button>
                </div>
            </Card>
        </PageContainer>
    );
};

export default SharePage;
