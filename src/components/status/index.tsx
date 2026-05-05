import styled from "@emotion/styled";
import { Button, Spin, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";

const FullPage = styled.div`
    align-items: center;
    color: var(--ant-color-text, rgba(15, 23, 42, 0.85));
    display: flex;
    flex-direction: column;
    gap: ${space.md}px;
    height: 100vh;
    height: 100dvh;
    justify-content: center;
    padding: ${space.lg}px;
    text-align: center;
    width: 100%;
`;

const PageSpin: React.FC = () => {
    return (
        <FullPage role="status" aria-live="polite">
            <Spin size="large" aria-label={microcopy.a11y.loadingPage} />
            <Typography.Text type="secondary">
                {microcopy.empty.commandPalette.loading}
            </Typography.Text>
        </FullPage>
    );
};

const PageError: React.FC<{ error: Error | null; onRetry?: () => void }> = ({
    error,
    onRetry
}) => {
    return (
        <FullPage role="alert">
            <Typography.Text
                style={{
                    fontSize: fontSize.lg,
                    fontWeight: fontWeight.semibold
                }}
                type="danger"
            >
                {error?.message ||
                    microcopy.feedback.loadFailed}
            </Typography.Text>
            {onRetry ? (
                <Button onClick={onRetry} type="primary">
                    {microcopy.actions.retry}
                </Button>
            ) : null}
        </FullPage>
    );
};

export { PageError, PageSpin };
