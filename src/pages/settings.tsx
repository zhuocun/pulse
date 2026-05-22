import {
    DesktopOutlined,
    LogoutOutlined,
    MoonOutlined,
    SunOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Card, Segmented, Space, Switch, Typography } from "antd";

import LanguageSwitcher from "../components/languageSwitcher";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import {
    fontSize,
    fontWeight,
    lineHeight,
    radius,
    space
} from "../theme/tokens";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Settings page (Phase 3 A3). Hosts the four controls that previously
 * lived inside the header account dropdown:
 *
 *   - Theme (dark mode) toggle
 *   - Language switcher
 *   - Board Copilot (AI) enabled toggle
 *   - Log out
 *
 * The header now demotes its right cluster on coarse pointers, so this
 * page is the canonical home for these controls on phone. Desktop
 * still reaches them via the header dropdown — both surfaces share the
 * same hooks (useColorScheme, useAiEnabled, useAuth) so a setting
 * change in one place is reflected in the other on next paint.
 */

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.xs}px;
    }
`;

const PageSubtitle = styled(Typography.Paragraph)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        font-size: ${fontSize.md}px;
        margin-bottom: ${space.xl}px;
    }
`;

const SettingsList = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.md}px;
`;

const Row = styled(Card)`
    && {
        border-radius: ${radius.lg}px;
    }
    && .ant-card-body {
        align-items: center;
        display: flex;
        gap: ${space.md}px;
        justify-content: space-between;
        padding: ${space.md}px ${space.lg}px;
    }
`;

const RowLabel = styled.div`
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    gap: ${space.sm}px;
    min-width: 0;
`;

const RowText = styled(Typography.Text)`
    && {
        font-size: ${fontSize.md}px;
        font-weight: ${fontWeight.medium};
    }
`;

const SettingsPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.settings), false);
    const { logout } = useAuth();
    const {
        available: aiAvailable,
        enabled: aiEnabled,
        setEnabled: setAiEnabled
    } = useAiEnabled();
    const {
        preference: themePreference,
        scheme,
        setPreference
    } = useColorScheme();

    return (
        <PageContainer>
            <PageHeading level={1}>{microcopy.settings.pageTitle}</PageHeading>
            <PageSubtitle>{microcopy.settings.pageSubtitle}</PageSubtitle>
            <SettingsList>
                <Row data-testid="settings-row-theme">
                    <RowLabel>
                        <Space size={space.xs}>
                            {scheme === "dark" ? (
                                <MoonOutlined aria-hidden />
                            ) : (
                                <SunOutlined aria-hidden />
                            )}
                            <RowText>{microcopy.settings.theme}</RowText>
                        </Space>
                    </RowLabel>
                    {/*
                     * 3-state Segmented preserves the underlying
                     * `useColorScheme()` contract (light / dark / system).
                     * The previous 2-state Switch collapsed `system` to
                     * either light or dark on toggle and left the user
                     * no way back to "follow OS" once they touched it.
                     * Aria-label stays on the wrapping group so screen
                     * readers announce the control purpose; each item
                     * carries its own visible label + icon.
                     */}
                    <Segmented
                        aria-label={microcopy.settings.theme}
                        options={[
                            {
                                label: microcopy.settings.themeLight,
                                value: "light",
                                icon: <SunOutlined aria-hidden />
                            },
                            {
                                label: microcopy.settings.themeDark,
                                value: "dark",
                                icon: <MoonOutlined aria-hidden />
                            },
                            {
                                label: microcopy.settings.themeSystem,
                                value: "system",
                                icon: <DesktopOutlined aria-hidden />
                            }
                        ]}
                        onChange={(value) =>
                            setPreference(value as "light" | "dark" | "system")
                        }
                        value={themePreference}
                    />
                </Row>
                <Row data-testid="settings-row-language">
                    {/* Re-uses the existing LanguageSwitcher component
                        from the header dropdown so the control behaves
                        identically across surfaces. */}
                    <LanguageSwitcher />
                </Row>
                {aiAvailable ? (
                    <Row data-testid="settings-row-ai">
                        <RowLabel>
                            <RowText>{microcopy.settings.aiEnabled}</RowText>
                        </RowLabel>
                        <Switch
                            aria-label={microcopy.settings.toggleBoardCopilot}
                            checked={aiEnabled}
                            onChange={setAiEnabled}
                        />
                    </Row>
                ) : null}
                <Row data-testid="settings-row-logout">
                    <RowLabel>
                        <Space size={space.xs}>
                            <LogoutOutlined aria-hidden />
                            <RowText>{microcopy.actions.logOut}</RowText>
                        </Space>
                    </RowLabel>
                    <Button
                        aria-label={microcopy.actions.logOut}
                        danger
                        onClick={() => {
                            logout();
                        }}
                    >
                        {microcopy.actions.logOut}
                    </Button>
                </Row>
            </SettingsList>
        </PageContainer>
    );
};

export default SettingsPage;
