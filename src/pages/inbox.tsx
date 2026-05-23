import styled from "@emotion/styled";
import { Typography } from "antd";

import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Inbox page (Phase 3 A3). Placeholder surface for triage proposals,
 * @-mentions, and AI activity. Wiring will come in A8 (AI Inbox +
 * activity ledger). Today we mount the page so the bottom-tab Inbox
 * entry routes to something real instead of a 404.
 */

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.sm}px;
    }
`;

const InboxPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.inbox), false);

    return (
        <PageContainer>
            <PageHeading level={1}>{microcopy.inbox.heading}</PageHeading>
            <EmptyState
                data-testid="inbox-empty-state"
                description={microcopy.inbox.emptyDescription}
                headingLevel={2}
                title={microcopy.inbox.emptyTitle}
                variant="tasks"
            />
        </PageContainer>
    );
};

export default InboxPage;
