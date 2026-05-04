import { CaretDownOutlined, TeamOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { List, Popover, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    fontSize,
    fontWeight,
    modalGutterPx,
    radius,
    space
} from "../../theme/tokens";
import useReactQuery from "../../utils/hooks/useReactQuery";
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
        letter-spacing: 0.06em;
        margin-bottom: ${space.xs}px;
        text-transform: uppercase;
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

const MemberPopover: React.FC = () => {
    const { data: members, refetch } =
        useReactQuery<IMember[]>("users/members");

    const list = members ?? [];

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
        <Popover
            onOpenChange={(open) => {
                if (open) refetch();
            }}
            placement="bottomLeft"
            content={content}
        >
            <TriggerButton
                aria-label={microcopy.a11y.viewTeamMembers}
                type="button"
            >
                <TeamOutlined aria-hidden />
                <TriggerLabel>{microcopy.labels.members}</TriggerLabel>
                <CaretDownOutlined
                    aria-hidden
                    style={{ fontSize: 10, opacity: 0.6 }}
                />
            </TriggerButton>
        </Popover>
    );
};

export default MemberPopover;
