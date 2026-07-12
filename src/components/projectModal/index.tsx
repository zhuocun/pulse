import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { modalWidthCss } from "../../theme/tokens";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useMembersList from "../../utils/hooks/useMembersList";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import useUnsavedChangesGuard from "../../utils/hooks/useUnsavedChangesGuard";
import deleteProjectCallback from "../../utils/optimisticUpdate/deleteProject";
import ErrorBox from "../errorBox";
import ResponsiveFormSheet from "../responsiveFormSheet";

/**
 * Create / edit project surface.
 *
 * Per the surface taxonomy in `docs/ui-ux-optimization-plan.md` §2.A.5, this
 * is a "focused edit / required confirmation" intent and ships as a Modal,
 * not a 100vw side Drawer. Field labels, placeholders, and submit copy come
 * from the central microcopy bundle so casing stays consistent and we never
 * fall back to the banned `Submit` / `OK` strings.
 */
interface ProjectFormValues {
    projectName: string;
    organization: string;
    managerId: string;
    [key: string]: unknown;
}

const isVisible = (element: HTMLElement): boolean => {
    if (
        !element.isConnected ||
        element.hidden ||
        element.closest('[hidden], [aria-hidden="true"], [inert]')
    ) {
        return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
};

const restoreFocusAfterOverlayUnmount = (target: HTMLElement | null) => {
    if (!target?.isConnected) return;
    const focusTarget = target;

    let timeout: number | undefined;
    const observer = new MutationObserver(restoreIfReleased);

    function cleanup() {
        observer.disconnect();
        if (timeout !== undefined) window.clearTimeout(timeout);
    }

    function restoreIfReleased() {
        if (!focusTarget.isConnected) {
            cleanup();
            return;
        }
        if (!isVisible(focusTarget)) return;

        const activeElement = document.activeElement;
        if (
            activeElement instanceof HTMLElement &&
            activeElement !== document.body &&
            activeElement !== focusTarget &&
            activeElement.isConnected
        ) {
            if (activeElement.closest('[role="dialog"]')) return;
            cleanup();
            return;
        }

        focusTarget.focus({ preventScroll: true });
        if (document.activeElement === focusTarget) cleanup();
    }

    observer.observe(document.body, {
        attributeFilter: ["aria-hidden", "hidden", "inert"],
        attributes: true,
        childList: true,
        subtree: true
    });
    timeout = window.setTimeout(cleanup, 1_000);
    window.queueMicrotask(restoreIfReleased);
};

const ProjectModal: React.FC = () => {
    const { isModalOpened, closeModal, editingProject, isLoading } =
        useProjectModal();
    const isEditing = Boolean(editingProject);
    const isPhoneChrome = useIsPhoneChrome();
    const openerRef = useRef<HTMLElement | null>(null);
    const lastPageFocusRef = useRef<HTMLElement | null>(null);
    const lastModalFocusRef = useRef<HTMLElement | null>(null);
    const modalOpenRef = useRef(isModalOpened);
    const wasOpenRef = useRef(false);
    modalOpenRef.current = isModalOpened;

    useEffect(() => {
        const trackFocus = (event: FocusEvent) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (modalOpenRef.current) {
                lastModalFocusRef.current = event.target;
            } else if (event.target !== document.body) {
                lastPageFocusRef.current = event.target;
            }
        };
        document.addEventListener("focusin", trackFocus);
        return () => document.removeEventListener("focusin", trackFocus);
    }, []);

    if (isModalOpened !== wasOpenRef.current) {
        if (isModalOpened && typeof document !== "undefined") {
            const activeElement =
                document.activeElement instanceof HTMLElement &&
                document.activeElement !== document.body
                    ? document.activeElement
                    : lastPageFocusRef.current;
            if (activeElement) openerRef.current = activeElement;
        }
        wasOpenRef.current = isModalOpened;
    }

    const [saveError, setSaveError] = useState<Error | null>(null);
    const createProjectMutation = useReactMutation<IProject>(
        "projects",
        "POST",
        undefined,
        undefined,
        (err) => setSaveError(err)
    );
    const updateProjectMutation = useReactMutation<IProject>(
        "projects",
        "PUT",
        undefined,
        undefined,
        (err) => setSaveError(err)
    );
    const activeMutation = isEditing
        ? updateProjectMutation
        : createProjectMutation;
    const { mutateAsync, isLoading: mutateLoading } = activeMutation;
    // Companion mutations used purely as undo closures for the
    // activity-feed Undo button:
    //   • create undo → DELETE the just-created project
    //   • update undo → PUT the captured before-state
    // Both are fire-and-forget — errors are swallowed so an Undo
    // gesture doesn't double-surface the auto-revert toast.
    const { mutateAsync: undoCreate } = useReactMutation(
        "projects",
        "DELETE",
        ["projects"],
        deleteProjectCallback,
        () => {}
    );
    const { mutateAsync: undoUpdate } = useReactMutation(
        "projects",
        "PUT",
        undefined,
        undefined,
        () => {}
    );
    const { record: recordActivity } = useActivityFeed();
    const { show: showUndoToast } = useUndoToast();

    const [form] = Form.useForm<ProjectFormValues>();
    const onClose = () => {
        const opener = openerRef.current;
        closeModal();
        form.resetFields();
        setSaveError(null);
        restoreFocusAfterOverlayUnmount(opener);
    };
    // §2.A.1 — guard the cancel / mask-close paths so a half-filled form
    // isn't discarded without a prompt. A clean (untouched) form still
    // closes immediately.
    const { requestClose, isPrompting, confirmNode } = useUnsavedChangesGuard({
        isDirty: () => form.isFieldsTouched(),
        onConfirmDiscard: onClose
    });
    const focusBeforePromptRef = useRef<HTMLElement | null>(null);
    const wasPromptingRef = useRef(false);
    useLayoutEffect(() => {
        const promptClosed = wasPromptingRef.current && !isPrompting;
        wasPromptingRef.current = isPrompting;
        if (!promptClosed || !isModalOpened) return;

        restoreFocusAfterOverlayUnmount(focusBeforePromptRef.current);
    }, [isModalOpened, isPrompting]);
    const requestProjectClose = () => {
        focusBeforePromptRef.current =
            document.activeElement instanceof HTMLElement &&
            document.activeElement !== document.body
                ? document.activeElement
                : lastModalFocusRef.current;
        requestClose();
    };
    const onFinish = async (input: {
        projectName: string;
        organization: string;
        managerId: string;
    }) => {
        // The server derives the manager from the JWT subject on create
        // (`POST /api/v1/projects`) and ignores any `managerId` sent in
        // the body — see `backend/app/services/project_service.py`.
        // Drop the field from the create payload so the wire shape matches
        // what the server actually consumes; ownership-transfer flows
        // through `PUT` and still passes it.
        const { managerId: _managerId, ...createOnly } = input;
        const payload = isEditing
            ? { ...editingProject, ...input }
            : { ...editingProject, ...createOnly };
        // Capture the pre-update IProject before the PUT lands so the
        // activity-feed undo can PUT it back. Snapshot here rather than
        // inside the closure because the cache flips to the updated
        // payload once `mutateAsync` resolves.
        const beforeState = isEditing
            ? ({ ...editingProject } as IProject | undefined)
            : undefined;
        try {
            const persisted = await mutateAsync(payload);
            setSaveError(null);
            /*
             * Phase 4.3 — record the project create/update into the
             * activity feed before closing. We thread through the
             * intent (create vs update) and the project name so the
             * drawer row reads naturally for the user.
             *
             * Undo closures:
             *   • create → DELETE the project by its server id
             *   • update → PUT the captured before-state
             * Both are fire-and-forget; the closure is undefined when
             * the response is missing the id we need so a malformed
             * payload doesn't render a broken Undo button.
             */
            const createdId = persisted?._id;
            const undoCallback = isEditing
                ? beforeState
                    ? () => {
                          void undoUpdate(
                              beforeState as unknown as Record<string, unknown>
                          );
                      }
                    : undefined
                : createdId
                  ? () => {
                        void undoCreate({ projectId: createdId });
                    }
                  : undefined;
            recordActivity({
                kind: "project",
                action: isEditing ? "update" : "create",
                summary: microcopyString(
                    isEditing
                        ? microcopy.activityFeed.descriptions.projectUpdated
                        : microcopy.activityFeed.descriptions.projectCreated
                ).replace("{name}", input.projectName),
                undo: undoCallback
            });
            // Transient Undo toast — the immediate recovery path alongside
            // the activity-feed entry, reusing the same inverse closure
            // (create → DELETE the project; update → PUT the before-state).
            // Skipped when the closure is undefined (a malformed create
            // response with no id) so we never render an Undo we can't honor.
            if (undoCallback) {
                showUndoToast({
                    description: isEditing
                        ? microcopy.feedback.projectUpdated
                        : microcopy.feedback.projectCreated,
                    analyticsTag: isEditing
                        ? "project.update"
                        : "project.create",
                    undo: async () => {
                        undoCallback();
                    }
                });
            }
            onClose();
        } catch {
            // ErrorBox surfaces the message via the onError callback above;
            // keep the modal open so the user can retry without re-entering
            // their changes.
        }
    };
    const submit = () => {
        form.submit();
    };
    const modalTitle = isEditing
        ? microcopy.actions.editProject
        : microcopy.actions.createProject;
    const okText = isEditing
        ? microcopy.actions.save
        : microcopy.actions.createProject;

    const hydratedProjectIdRef = useRef<string | undefined>(undefined);
    const wasHydrationOpenRef = useRef(false);
    useEffect(() => {
        const opening = isModalOpened && !wasHydrationOpenRef.current;
        wasHydrationOpenRef.current = isModalOpened;
        if (!isModalOpened || !editingProject) return;

        const projectChanged =
            hydratedProjectIdRef.current !== editingProject._id;
        const hydrate = () => {
            if (projectChanged || opening) {
                form.setFieldsValue(
                    editingProject as unknown as Partial<ProjectFormValues>
                );
                return;
            }

            if (!form.getFieldValue("managerId")) {
                form.setFieldsValue({ managerId: editingProject.managerId });
            }
        };
        hydrate();
        hydratedProjectIdRef.current = editingProject._id;
        const hydrationTimer = window.setTimeout(hydrate, 0);
        return () => window.clearTimeout(hydrationTimer);
    }, [editingProject, form, isModalOpened, isPhoneChrome]);

    /*
     * Route the manager dropdown through the shared `useMembersList` hook so
     * we hit the same `["users/members"]` cache as the page header,
     * MemberPopover, TaskModal, etc., and inherit the 5-minute staleTime —
     * otherwise opening the modal more than 30 s after page load fired an
     * unnecessary refetch under the default staleTime.
     */
    const { data: members } = useMembersList();

    /*
     * Footer rendered as a plain node so the SAME markup feeds both the
     * desktop Modal footer slot and the phone Sheet footer slot (the
     * Sheet does not support AntD's footer render-prop form). Cancel
     * always precedes Save/Create in DOM order so the primary action is
     * the bottom-most / right-most target — on phone-narrow the column
     * puts the primary in the thumb zone (QW-19), and on tablet/desktop
     * the row keeps it right-aligned. Edge-to-edge `block` buttons on
     * narrow widths avoid the stray 8px inter-button offset the default
     * AntD footer produced when both buttons wrapped.
     */
    const footer = (
        <div className="flex flex-col justify-end gap-xs sm:flex-row">
            <Button
                className="w-full sm:w-auto"
                onClick={requestProjectClose}
                size="lg"
                variant="default"
            >
                {microcopy.actions.cancel}
            </Button>
            <Button
                className="w-full sm:w-auto"
                disabled={isLoading}
                loading={mutateLoading}
                onClick={submit}
                size="lg"
                variant="primary"
            >
                {okText}
            </Button>
        </div>
    );

    return (
        <>
            {confirmNode}
            <ResponsiveFormSheet
                centered
                defaultDetent="large"
                destroyOnHidden={false}
                footer={footer}
                forceRender
                onClose={requestProjectClose}
                open={isModalOpened}
                styles={{
                    body: {
                        /*
                         * Subtract `env(keyboard-inset-height)` so the modal
                         * body shrinks above the iOS soft keyboard instead of
                         * pushing the footer below the fold. Falls back to
                         * `0px` on browsers without the env variable so the
                         * desktop layout is unchanged. See QW-18 in
                         * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
                         *
                         * The `max(80px, …)` wrapper clamps the result so the
                         * body never collapses to a negative height in
                         * landscape orientation with the keyboard up — a
                         * 375 × 667 device in landscape reports `100dvh` ≈
                         * 375 px and a ~260 px keyboard inset would otherwise
                         * subtract past zero (Bug 6).
                         */
                        maxHeight:
                            "max(80px, calc(100dvh - 220px - env(keyboard-inset-height, 0px)))",
                        overflowY: "auto"
                    }
                }}
                title={modalTitle}
                width={modalWidthCss(520)}
            >
                <div className="relative">
                    {isLoading ? (
                        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-background/60">
                            <Spinner label={microcopy.a11y.loadingProject} />
                        </div>
                    ) : null}
                    <Typography.Text
                        className="mb-md block leading-normal"
                        type="secondary"
                    >
                        {isEditing
                            ? microcopy.projectModal.editDescription
                            : microcopy.projectModal.createDescription}
                    </Typography.Text>
                    <Form form={form} layout="vertical" onFinish={onFinish}>
                        <ErrorBox error={saveError} />
                        <Form.Item
                            label={microcopy.fields.projectName}
                            name="projectName"
                            required
                            rules={[
                                {
                                    required: true,
                                    whitespace: true,
                                    message:
                                        microcopy.validation.projectNameRequired
                                }
                            ]}
                            validateTrigger={["onBlur", "onSubmit"]}
                        >
                            <Input
                                autoComplete="off"
                                enterKeyHint="next"
                                inputMode="text"
                            />
                        </Form.Item>
                        <Form.Item
                            label={microcopy.fields.organization}
                            name="organization"
                            required
                            rules={[
                                {
                                    required: true,
                                    whitespace: true,
                                    message:
                                        microcopy.validation
                                            .organizationRequired
                                }
                            ]}
                            validateTrigger={["onBlur", "onSubmit"]}
                        >
                            <Input
                                autoComplete="organization"
                                enterKeyHint="next"
                                inputMode="text"
                            />
                        </Form.Item>
                        <Form.Item
                            label={microcopy.fields.manager}
                            name="managerId"
                            required
                            rules={[
                                {
                                    required: true,
                                    message:
                                        microcopy.validation.managerRequired
                                }
                            ]}
                            trigger="onValueChange"
                            validateTrigger={["onBlur", "onSubmit"]}
                        >
                            <Select>
                                <SelectTrigger
                                    aria-label={microcopy.fields.manager}
                                >
                                    <SelectValue
                                        placeholder={
                                            microcopy.placeholders.selectManager
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent className="z-[1200]">
                                    {(members ?? []).map((member) => (
                                        <SelectItem
                                            key={member._id}
                                            value={member._id}
                                        >
                                            {member.username}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Form.Item>
                    </Form>
                </div>
            </ResponsiveFormSheet>
        </>
    );
};

export default ProjectModal;
