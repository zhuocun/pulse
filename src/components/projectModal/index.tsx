import { Form, Grid, Input, Modal, Select, Spin, Typography } from "antd";
import { useForm } from "antd/lib/form/Form";
import { useEffect } from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize, lineHeight, modalWidthCss, space } from "../../theme/tokens";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useReactQuery from "../../utils/hooks/useReactQuery";
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

    const createProjectMutation = useReactMutation<IProject>(
        "projects",
        "POST"
    );
    const updateProjectMutation = useReactMutation<IProject>("projects", "PUT");
    const activeMutation = isEditing
        ? updateProjectMutation
        : createProjectMutation;
    const { mutateAsync, error, isLoading: mutateLoading } = activeMutation;

    const [form] = useForm();
    const onClose = () => {
        closeModal();
        form.resetFields();
    };
    const onFinish = (input: {
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
        mutateAsync(payload).then(onClose);
    };
    const submit = () => {
        form.submit();
    };
    const modalTitle = isEditing ? "Edit project" : "Create project";
    const okText = isEditing
        ? microcopy.actions.save
        : `${microcopy.actions.create} project`;

    useEffect(() => {
        form.setFieldsValue(editingProject);
    }, [editingProject, form]);

    const { data: members } = useReactQuery<IMember[]>("users/members");

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
             * line up edge-to-edge. Tablet / desktop keep the default
             * right-aligned arrangement.
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
                              <OkBtn />
                              <CancelBtn />
                          </div>
                      )
                    : undefined
            }
            styles={{
                body: {
                    maxHeight: "calc(100dvh - 220px)",
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
                        ? "Update project details and assignment."
                        : "Set a name, organization, and a manager to start tracking work."}
                </Typography.Text>
                <Form form={form} layout="vertical" onFinish={onFinish}>
                    <ErrorBox error={error} />
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
                            placeholder={`Select a ${microcopy.fields.manager.toLowerCase()}`}
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
