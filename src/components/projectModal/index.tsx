import { Form, Grid, Input, Modal, Select, Spin, Typography } from "antd";
import { useForm } from "antd/lib/form/Form";
import { useEffect, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize, lineHeight, modalWidthCss, space } from "../../theme/tokens";
import useMembersList from "../../utils/hooks/useMembersList";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactMutation from "../../utils/hooks/useReactMutation";
import ErrorBox from "../errorBox";

/**
 * Create / edit project surface.
 *
 * Per the surface taxonomy in `docs/ui-ux-optimization-plan.md` §2.A.5, this
 * is a "focused edit / required confirmation" intent and ships as a Modal,
 * not a 100vw side Drawer. Field labels, placeholders, and submit copy come
 * from the central microcopy bundle so casing stays consistent and we never
 * fall back to the banned `Submit` / `OK` strings.
 */
const ProjectModal: React.FC = () => {
    const { isModalOpened, closeModal, editingProject, isLoading } =
        useProjectModal();
    const isEditing = Boolean(editingProject);
    const screens = Grid.useBreakpoint();

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

    const [form] = useForm();
    const onClose = () => {
        closeModal();
        form.resetFields();
        setSaveError(null);
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
        try {
            await mutateAsync(payload);
            setSaveError(null);
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

    useEffect(() => {
        form.setFieldsValue(editingProject);
    }, [editingProject, form]);

    /*
     * Route the manager dropdown through the shared `useMembersList` hook so
     * we hit the same `["users/members"]` cache as the page header,
     * MemberPopover, TaskModal, etc., and inherit the 5-minute staleTime —
     * otherwise opening the modal more than 30 s after page load fired an
     * unnecessary refetch under the default staleTime.
     */
    const { data: members } = useMembersList();

    return (
        <Modal
            cancelText={microcopy.actions.cancel}
            centered
            confirmLoading={mutateLoading}
            destroyOnHidden={false}
            forceRender
            okButtonProps={{
                block: !screens.sm,
                disabled: isLoading,
                size: "large"
            }}
            cancelButtonProps={{ block: !screens.sm, size: "large" }}
            okText={okText}
            onCancel={onClose}
            onOk={submit}
            open={isModalOpened}
            /*
             * Phone-width footer: the default AntD footer keeps the two
             * buttons in one flex row with `>*+* { margin-inline-start: 8px }`.
             * When both are `block` (full-width) they wrap onto two rows but
             * the OK button still gets the 8 px left margin and ends up
             * visibly offset from the Cancel button. Render a stacked
             * column without that inter-button margin so the two buttons
             * line up edge-to-edge — with Save (primary) at the bottom in
             * the thumb zone and Cancel above it per QW-19 in
             * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
             * Tablet / desktop keep the default right-aligned arrangement.
             */
            footer={
                !screens.sm
                    ? (_, { OkBtn, CancelBtn }) => (
                          <div
                              style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: space.xs
                              }}
                          >
                              <CancelBtn />
                              <OkBtn />
                          </div>
                      )
                    : undefined
            }
            styles={{
                body: {
                    /*
                     * Subtract `env(keyboard-inset-height)` so the modal
                     * body shrinks above the iOS soft keyboard instead of
                     * pushing the footer below the fold. Falls back to
                     * `0px` on browsers without the env variable so the
                     * desktop layout is unchanged. See QW-18 in
                     * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
                     */
                    maxHeight:
                        "calc(100dvh - 220px - env(keyboard-inset-height, 0px))",
                    overflowY: "auto"
                }
            }}
            title={modalTitle}
            width={modalWidthCss(520)}
        >
            <Spin
                aria-label={microcopy.a11y.loadingProject}
                spinning={isLoading}
            >
                <Typography.Text
                    style={{
                        display: "block",
                        fontSize: fontSize.sm,
                        lineHeight: lineHeight.normal,
                        marginBottom: space.md
                    }}
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
                                    microcopy.validation.organizationRequired
                            }
                        ]}
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
                                message: microcopy.validation.managerRequired
                            }
                        ]}
                    >
                        <Select
                            options={(members ?? []).map((member) => ({
                                label: member.username,
                                value: member._id
                            }))}
                            placeholder={microcopy.placeholders.selectManager}
                            showSearch
                            optionFilterProp="label"
                        />
                    </Form.Item>
                </Form>
            </Spin>
        </Modal>
    );
};

export default ProjectModal;
