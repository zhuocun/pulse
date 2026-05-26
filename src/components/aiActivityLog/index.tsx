import { HistoryOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Badge,
    Button,
    Drawer,
    List,
    Modal,
    Popover,
    Space,
    Tooltip,
    Typography
} from "antd";
import React, { useCallback, useEffect, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import useAiLedger, { type LedgerEntry } from "../../utils/hooks/useAiLedger";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";

/**
 * AI activity ledger pill + expandable list (Phase 4 A8).
 *
 * The pill renders inline (counts AI mutations recorded this session)
 * and expands into a popover on desktop / bottom drawer on phone chrome.
 * Each row shows the description, a relative timestamp, and a Revert
 * button — the button is hidden when the entry's undo closure isn't
 * alive in this process (post-reload state where Redux survives but
 * function references don't). The whole component returns `null` when
 * there are no entries to keep the dock footer area uncluttered.
 *
 * The pill is `position: sticky` against the dock body so it never
 * blocks the underlying input composer; the dock body is a flex column
 * and the pill sits between the tab pane and the composer.
 */

const PillButton = styled.button`
    align-items: center;
    background: var(--ant-color-bg-elevated, rgba(255, 255, 255, 0.9));
    border: 1px solid var(--ant-color-border, rgba(15, 23, 42, 0.1));
    border-radius: ${radius.pill}px;
    color: var(--ant-color-text, rgba(15, 23, 42, 0.85));
    cursor: pointer;
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    /*
     * Cap the height at 32 px so the pill never crowds the input
     * composer mounted underneath inside the dock body. The composer
     * keeps its own min-height; the pill stays well under the dock's
     * footer breathing room.
     */
    max-height: 32px;
    padding: 4px ${space.sm}px;
    transition: background-color 120ms ease-in-out;
    white-space: nowrap;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(0, 0, 0, 0.04));
    }

    &:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 2px;
    }
`;

const ListWrapper = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    max-height: 60vh;
    min-width: 280px;
    overflow-y: auto;
    padding: 0;
`;

const ListHeader = styled.div`
    align-items: center;
    display: flex;
    justify-content: space-between;
    padding-bottom: ${space.xs}px;
`;

const Row = styled.div`
    align-items: flex-start;
    display: flex;
    gap: ${space.xs}px;
    justify-content: space-between;
    width: 100%;
`;

const RowMeta = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

const Description = styled(Typography.Text)`
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
`;

/*
 * Inline relative-time formatter. Delegates to the shared
 * `formatRelativeTime` util but reads from the dedicated
 * `aiActivityLog.relative*` keys (through `microcopyString`) so future
 * tuning ("just now" vs "moments ago") stays local to this surface. The
 * Proxy reads stay here so a locale switch propagates on the next tick.
 */
const formatRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopyString(microcopy.aiActivityLog.relativeJustNow),
        oneMinute: microcopyString(microcopy.aiActivityLog.relativeOneMinute),
        minutes: microcopyString(microcopy.aiActivityLog.relativeMinutes),
        oneHour: microcopyString(microcopy.aiActivityLog.relativeOneHour),
        hours: microcopyString(microcopy.aiActivityLog.relativeHours),
        oneDay: microcopyString(microcopy.aiActivityLog.relativeOneDay),
        days: microcopyString(microcopy.aiActivityLog.relativeDays)
    });

interface LedgerListBodyProps {
    entries: LedgerEntry[];
    isRevertable: (id: string) => boolean;
    onRevert: (id: string) => Promise<void>;
    onClear: () => void;
}

const LedgerListBody: React.FC<LedgerListBodyProps> = ({
    entries,
    isRevertable,
    onRevert,
    onClear
}) => {
    const [reverting, setReverting] = useState<string | null>(null);
    /*
     * `now` ticks every 30 s so the "2 min ago" labels stay fresh while
     * the list is open. The interval is cheap — it touches a single
     * setState and the rows re-render against the same data.
     */
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, []);

    const handleRevert = useCallback(
        async (id: string) => {
            setReverting(id);
            try {
                await onRevert(id);
            } finally {
                setReverting(null);
            }
        },
        [onRevert]
    );

    const handleClearAll = useCallback(() => {
        Modal.confirm({
            title: microcopyString(microcopy.aiActivityLog.clearConfirmTitle),
            content: microcopyString(microcopy.aiActivityLog.clearConfirmBody),
            okText: microcopyString(microcopy.aiActivityLog.clearConfirmOk),
            cancelText: microcopyString(
                microcopy.aiActivityLog.clearConfirmCancel
            ),
            onOk: () => onClear()
        });
    }, [onClear]);

    return (
        <ListWrapper data-testid="ai-activity-log-list">
            <ListHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {microcopyString(microcopy.aiActivityLog.listTitle)}
                </Typography.Text>
                <Button
                    onClick={handleClearAll}
                    size="small"
                    type="text"
                    disabled={entries.length === 0}
                >
                    {microcopyString(microcopy.aiActivityLog.clearAll)}
                </Button>
            </ListHeader>
            {entries.length === 0 ? (
                <Typography.Paragraph style={{ margin: 0 }} type="secondary">
                    {microcopyString(microcopy.aiActivityLog.emptyState)}
                </Typography.Paragraph>
            ) : (
                <List
                    dataSource={[...entries].reverse()}
                    locale={{ emptyText: " " }}
                    renderItem={(entry) => {
                        const revertable = isRevertable(entry.id);
                        const isBusy = reverting === entry.id;
                        return (
                            <List.Item
                                key={entry.id}
                                data-testid="ai-activity-log-row"
                                data-entry-id={entry.id}
                                style={{
                                    paddingInline: 0
                                }}
                            >
                                <Row>
                                    <RowMeta>
                                        <Tooltip
                                            placement="top"
                                            title={entry.description}
                                        >
                                            <Description>
                                                {entry.description}
                                            </Description>
                                        </Tooltip>
                                        <Typography.Text
                                            style={{ fontSize: fontSize.xs }}
                                            type="secondary"
                                        >
                                            {formatRelative(
                                                entry.timestamp,
                                                now
                                            )}
                                        </Typography.Text>
                                    </RowMeta>
                                    {revertable ? (
                                        <Button
                                            aria-label={microcopyString(
                                                microcopy.aiActivityLog
                                                    .revertAriaLabel
                                            ).replace(
                                                "{description}",
                                                entry.description
                                            )}
                                            data-testid="ai-activity-log-revert"
                                            loading={isBusy}
                                            onClick={() =>
                                                void handleRevert(entry.id)
                                            }
                                            size="small"
                                        >
                                            {microcopyString(
                                                microcopy.aiActivityLog.revert
                                            )}
                                        </Button>
                                    ) : (
                                        <Tooltip
                                            placement="left"
                                            title={microcopyString(
                                                microcopy.aiActivityLog
                                                    .revertUnavailable
                                            )}
                                        >
                                            <span aria-hidden>—</span>
                                        </Tooltip>
                                    )}
                                </Row>
                            </List.Item>
                        );
                    }}
                    size="small"
                    split={false}
                />
            )}
        </ListWrapper>
    );
};

const AiActivityLog: React.FC = () => {
    const { entries, revert, clear, isRevertable } = useAiLedger();
    const isPhone = useIsPhoneChrome();
    const [open, setOpen] = useState(false);

    /*
     * Auto-close the surface when the list goes empty so the dock body
     * snaps back to its default layout without leaving an empty popover
     * hovering over the composer.
     */
    useEffect(() => {
        if (entries.length === 0 && open) setOpen(false);
    }, [entries.length, open]);

    if (entries.length === 0) return null;

    const pillLabelTemplate =
        entries.length === 1
            ? microcopy.aiActivityLog.pillLabel
            : microcopy.aiActivityLog.pillLabelPlural;
    const pillLabel = microcopyString(pillLabelTemplate).replace(
        "{count}",
        String(entries.length)
    );

    const pillAriaLabel = open
        ? microcopyString(microcopy.aiActivityLog.pillAriaExpanded)
        : microcopyString(microcopy.aiActivityLog.pillAriaCollapsed);

    const pillButton = (
        <PillButton
            aria-expanded={open}
            aria-label={pillAriaLabel}
            data-testid="ai-activity-log-pill"
            onClick={() => setOpen((prev) => !prev)}
            type="button"
        >
            <Badge
                color="var(--ant-color-primary, #ea580c)"
                count={entries.length}
                offset={[0, 0]}
                size="small"
                style={{ marginInlineEnd: 2 }}
            >
                <HistoryOutlined aria-hidden style={{ marginInlineEnd: 4 }} />
            </Badge>
            <Space size={4}>
                <span>{pillLabel}</span>
            </Space>
        </PillButton>
    );

    const listBody = (
        <LedgerListBody
            entries={entries}
            isRevertable={isRevertable}
            onClear={clear}
            onRevert={revert}
        />
    );

    if (isPhone) {
        return (
            <div data-testid="ai-activity-log">
                {pillButton}
                <Drawer
                    closable
                    data-testid="ai-activity-log-drawer"
                    onClose={() => setOpen(false)}
                    open={open}
                    placement="bottom"
                    size="default"
                    title={microcopyString(microcopy.aiActivityLog.listTitle)}
                >
                    {listBody}
                </Drawer>
            </div>
        );
    }

    return (
        <div data-testid="ai-activity-log">
            <Popover
                content={listBody}
                onOpenChange={setOpen}
                open={open}
                overlayStyle={{ maxWidth: 360 }}
                placement="topLeft"
                trigger="click"
            >
                {pillButton}
            </Popover>
        </div>
    );
};

export default AiActivityLog;
