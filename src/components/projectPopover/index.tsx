import { CaretDownOutlined, FolderOpenOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Divider, Popover, Typography } from "antd";
import { useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import {
    fontSize,
    fontWeight,
    modalGutterPx,
    radius,
    space
} from "../../theme/tokens";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactQuery from "../../utils/hooks/useReactQuery";
import { NoPaddingButton } from "../projectList";

const ContentContainer = styled.div`
    /* Dynamic viewport unit keeps the popover from jumping when the iOS
     * Safari URL bar collapses. The vh declaration stays as a fallback. */
    max-height: 60vh;
    max-height: 60dvh;
    max-width: min(22rem, calc(100dvw - ${modalGutterPx}px));
    min-width: min(18rem, calc(100dvw - ${modalGutterPx}px));
    overflow-y: auto;
`;

const SectionLabel = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const ProjectListWrapper = styled.div`
    display: grid;
    gap: 2px;
    margin-top: ${space.xs}px;
`;

const ProjectItemButton = styled(NoPaddingButton)`
    && {
        align-items: center;
        border-radius: ${radius.sm}px;
        display: flex;
        font-weight: ${fontWeight.medium};
        height: auto;
        justify-content: flex-start;
        padding: ${space.xs}px ${space.sm}px;
        text-align: left;
        width: 100%;
    }

    &&:hover,
    &&:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.04));
    }
`;

/**
 * Lightweight project switcher used inside the project detail breadcrumb.
 *
 * The trigger is a real `<button>` (not a bare `<span>`) so it is keyboard
 * focusable and announces correctly to screen readers; popover placement
 * defaults to `bottom` so it does not clip on narrow viewports.
 *
 * `line-height: 1` and small symmetric padding keep the trigger's visual
 * height aligned with the rest of the breadcrumb items (the separator,
 * the project name) so the row reads as a single baseline. Touch hit
 * area is expanded via padding under `(pointer: coarse)` rather than a
 * forced `min-height` that would push the trigger off the row centerline
 * on desktop.
 */
const TriggerButton = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text, rgba(15, 23, 42, 0.85));
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    line-height: 1;
    padding: ${space.xxs}px ${space.xs}px;
    transition: background-color 120ms ease-out;
    white-space: nowrap;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.04));
    }

    @media (pointer: coarse) {
        min-height: 44px;
        padding: ${space.xs}px ${space.sm}px;
    }
`;

const ProjectPopover: React.FC = () => {
    const { openModal } = useProjectModal();
    const { data: projects } = useReactQuery<IProject[]>("projects");
    const navigate = useNavigate();

    const content = (
        <ContentContainer>
            <SectionLabel>{microcopy.projectsPage.title}</SectionLabel>
            <ProjectListWrapper>
                {projects?.map((project) => (
                    <ProjectItemButton
                        key={project._id}
                        onClick={() =>
                            navigate(`/projects/${project._id}`, {
                                viewTransition: true
                            })
                        }
                        type="text"
                    >
                        {project.projectName}
                    </ProjectItemButton>
                ))}
            </ProjectListWrapper>
            <Divider style={{ margin: `${space.sm}px 0` }} />
            <NoPaddingButton onClick={openModal} type="link">
                {microcopy.actions.createProject}
            </NoPaddingButton>
        </ContentContainer>
    );

    return (
        <Popover content={content} placement="bottomLeft">
            <TriggerButton
                aria-haspopup="menu"
                aria-label={microcopy.a11y.switchProject}
                type="button"
            >
                <FolderOpenOutlined aria-hidden />
                {microcopy.projectsPage.title}
                <CaretDownOutlined
                    aria-hidden
                    style={{ fontSize: 10, opacity: 0.6 }}
                />
            </TriggerButton>
        </Popover>
    );
};

export default ProjectPopover;
