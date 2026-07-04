import { CaretDownOutlined, TeamOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Avatar, List, Popover, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    fontSize,
    fontWeight,
    modalGutterPx,
    radius,
    space
} from "../../theme/tokens";
import useMembersList from "../../utils/hooks/useMembersList";
import EmptyState from "../emptyState";
import UserAvatar from "../userAvatar";

const ContentContainer = styled.div`
    /* Dynamic viewport unit keeps the popover from jumping when the iOS
     * Safari URL bar collapses. The vh declaration stays as a fallback. */
    max-height: 60vh;
    max-height: 60dvh;
    max-width: min(30rem, calc(100dvw - ${modalGutterPx}px));
    min-width: min(20rem, calc(100dvw - ${modalGutterPx}px));
    overflow-y: auto;
    overscroll-behavior: contain;
`;

const TriggerLabel = styled.span`
    @media (max-width: ${breakpoints.sm - 1}px) {
        display: none;
    }
`;

const SectionLabel = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
        display: block;
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.semibold};
        margin-bottom: ${space.xs}px;
    }
`;

const TriggerButton = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radius.md}px;
    color: var(--ant-color-text, rgba(15, 23, 42, 0.85));
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    min-height: 32px;
    padding: ${space.xxs}px ${space.sm}px;
    transition: background-color 120ms ease-out;
    white-space: nowrap;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.04));
    }

    @media (pointer: coarse) {
        min-height: 44px;
    }
`;

const TriggerMeta = styled.span`
    align-items: center;
    display: inline-flex;
    gap: ${space.xs}px;
`;

const TriggerAvatarGroup = styled(Avatar.Group)`
    .ant-avatar {
        border-color: var(--ant-color-bg-elevated, #fff);
    }
`;

const TriggerCountBadge = styled.span`
    align-items: center;
    background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.08));
    border-radius: ${radius.pill}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.7));
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    justify-content: center;
    line-height: 1;
    min-width: 24px;
    padding: 2px ${space.xs}px;
`;

const MemberPopover: React.FC = () => {
    const { data: members } = useMembersList();

    const list = members ?? [];
    const previewMembers = list.slice(0, 3);

    const content = (
        <ContentContainer>
            <SectionLabel>{microcopy.labels.teamMembers}</SectionLabel>
            {list.length === 0 ? (
                <EmptyState
                    title={microcopy.empty.members.title}
                    description={microcopy.empty.members.description}
                />
            ) : (
                <List
                    dataSource={list}
                    itemLayout="horizontal"
                    renderItem={(member) => (
                        <List.Item key={member._id}>
                            <List.Item.Meta
                                avatar={
                                    <UserAvatar
                                        id={member._id}
                                        name={member.username}
                                        size="small"
                                    />
                                }
                                description={member.email}
                                title={member.username}
                            />
                        </List.Item>
                    )}
                    size="small"
                />
            )}
        </ContentContainer>
    );

    return (
        <Popover placement="bottomLeft" content={content}>
            <TriggerButton
                aria-label={microcopy.a11y.viewTeamMembers}
                type="button"
            >
                <TeamOutlined aria-hidden />
                <TriggerLabel>{microcopy.labels.members}</TriggerLabel>
                <TriggerMeta aria-hidden>
                    <TriggerAvatarGroup max={{ count: 3 }} size="small">
                        {previewMembers.map((member) => (
                            <UserAvatar
                                id={member._id}
                                key={member._id}
                                name={member.username}
                                size="small"
                            />
                        ))}
                    </TriggerAvatarGroup>
                    <TriggerCountBadge>{list.length}</TriggerCountBadge>
                </TriggerMeta>
                <CaretDownOutlined
                    aria-hidden
                    style={{ fontSize: 10, opacity: 0.6 }}
                />
            </TriggerButton>
        </Popover>
    );
};

export default MemberPopover;
