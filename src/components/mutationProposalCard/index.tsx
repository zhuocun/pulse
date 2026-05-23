import styled from "@emotion/styled";
import { Button, Space, Table, Tag, Typography } from "antd";
import React, { useEffect, useRef, useState } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy, microcopyString } from "../../constants/microcopy";
import type { MutationProposal, TaskUpdate } from "../../interfaces/agent";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import useAiLedger from "../../utils/hooks/useAiLedger";
import CopilotChip, { type CopilotChipTone } from "../copilotChip";

/**
 * Mutation preview card (PRD v3 §10.1, §7.4, C-R9). Renders the proposed
 * diff with old → new field values, a risk band chip, and Accept/Reject
 * buttons. Lives inline (chat drawer) or in a modal dialog (review-each
 * flow). The component is render-only — surfaces wire up the actual
 * `agent.resume({ accepted })` call so they can also clear local state
 * (e.g. close the drawer or focus the next pending proposal).
 */
const Wrap = styled.div`
    background: var(--color-copilot-bg-subtle);
    border: 1px solid var(--color-copilot-bg-medium);
    border-radius: ${radius.md}px;
    margin: ${space.xs}px 0;
    padding: ${space.sm}px;
`;

const Heading = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
    margin-bottom: ${space.xs}px;
`;

const FooterHint = styled.div`
    color: var(--ant-color-text-secondary, #6b7280);
    font-size: ${fontSize.xs}px;
    margin-top: ${space.xs}px;
`;

const UndoBar = styled.div`
    align-items: flex-start;
    background: var(--ant-color-warning-bg, #fffbe6);
    border: 1px solid var(--ant-color-warning-border, #ffe58f);
    border-radius: ${radius.sm}px;
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    margin-top: ${space.sm}px;
    padding: ${space.xs}px ${space.sm}px;
`;

const UndoBarRow = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;
    width: 100%;
`;

interface MutationProposalCardProps {
    proposal: MutationProposal;
    onAccept: () => void;
    onReject: () => void;
    /**
     * Optional Undo CTA. Rendered only when `proposal.undoable === true`
     * AND a callback is supplied. Chat's apply tool uses the backend
     * journal/undo endpoints through its toast flow; this prop remains
     * for surfaces that need a card-local post-commit undo affordance.
     */
    onUndo?: () => void;
    /** Disables the buttons while a previous click is in flight. */
    isLoading?: boolean;
    /**
     * Override the default verb. The default extracts a verb from
     * `proposal.description`; pass a string when the surface knows the
     * exact action label (e.g. "Reassign 2 tasks").
     */
    title?: string;
}

const riskTone = (risk: MutationProposal["risk"]): CopilotChipTone => {
    if (risk === "high") return "red";
    if (risk === "med") return "orange";
    return "green";
};

const riskLabel = (risk: MutationProposal["risk"]) => {
    if (risk === "high") return microcopy.mutation.riskHigh;
    if (risk === "med") return microcopy.mutation.riskMedium;
    return microcopy.mutation.riskLow;
};

interface DiffRow {
    key: string;
    field: string;
    from: React.ReactNode;
    to: React.ReactNode;
}

const formatValue = (value: unknown): React.ReactNode => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string" && value.length === 0) return "—";
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (typeof value === "string") return value;
    return JSON.stringify(value);
};

const taskFieldLabel = (field: TaskUpdate["field"]): string => {
    const labels = microcopy.mutation.fields;
    switch (field) {
        case "coordinatorId":
            return labels.coordinator;
        case "columnId":
            return labels.column;
        case "epic":
            return labels.epic;
        case "type":
            return labels.type;
        case "storyPoints":
            return labels.storyPoints;
        case "taskName":
            return labels.taskName;
        case "note":
            return labels.note;
        default:
            return field;
    }
};

const buildRows = (proposal: MutationProposal): DiffRow[] => {
    const rows: DiffRow[] = [];
    proposal.diff.task_updates?.forEach((update, index) => {
        rows.push({
            key: `task-${update.task_id}-${update.field}-${index}`,
            field: taskFieldLabel(update.field),
            from: formatValue(update.from),
            to: formatValue(update.to)
        });
    });
    proposal.diff.column_updates?.forEach((update, index) => {
        rows.push({
            key: `column-${update.column_id}-${update.field}-${index}`,
            field: microcopy.mutation.columnFieldLabel.replace(
                "{field}",
                update.field
            ),
            from: formatValue(update.from),
            to: formatValue(update.to)
        });
    });
    proposal.diff.bulk_apply?.forEach((bulk, index) => {
        const targets =
            bulk.targets.length === 1
                ? microcopy.counts.targets.one
                : microcopy.counts.targets.other;
        rows.push({
            key: `bulk-${bulk.operation}-${index}`,
            field: bulk.operation,
            from: targets.replace("{count}", String(bulk.targets.length)),
            to: formatValue(bulk.payload)
        });
    });
    return rows;
};

/**
 * Inferred proposal "kind" used to pick a verb for the Apply button.
 *
 * The wire schema doesn't carry an explicit `kind` field
 * (`interfaces/agent.d.ts`); we read the diff shape and pick the most
 * specific verb that still describes every row in the proposal. The
 * fallback is the generic `actions.apply` literal so consumers that
 * wire a heterogeneous diff (column rename + task move in the same
 * proposal) get the safe "Apply" verb instead of a misleading
 * specialization.
 *
 * Returns `null` when the diff shape doesn't fit any specialization;
 * the caller substitutes `microcopy.actions.apply` in that case.
 */
const APPLY_VERB_KIND_KEYS = [
    "create",
    "update",
    "delete",
    "move",
    "reassign",
    "renameColumn"
] as const;

type ProposalApplyKind = (typeof APPLY_VERB_KIND_KEYS)[number];

const inferApplyKind = (
    proposal: MutationProposal
): ProposalApplyKind | null => {
    const taskUpdates = proposal.diff.task_updates ?? [];
    const columnUpdates = proposal.diff.column_updates ?? [];
    const bulkApply = proposal.diff.bulk_apply ?? [];
    const hasTaskUpdates = taskUpdates.length > 0;
    const hasColumnUpdates = columnUpdates.length > 0;
    const hasBulkApply = bulkApply.length > 0;

    /*
     * Heterogeneous diffs deliberately fall through to the generic
     * Apply verb — picking a specialization for a mixed diff would
     * mislabel half the changes. A pure bulk_apply diff carries its
     * own operation name we can map to a verb; mixed bulk + tasks +
     * columns falls through.
     */
    if (hasBulkApply && !hasTaskUpdates && !hasColumnUpdates) {
        const op = bulkApply[0]?.operation;
        if (op === "create") return "create";
        if (op === "delete") return "delete";
        if (op === "assign" || op === "reassign") return "reassign";
        if (op === "set_column" || op === "move") return "move";
        return "update";
    }
    if (!hasTaskUpdates && hasColumnUpdates && !hasBulkApply) {
        // Column-only diffs that touch `name` are renames; anything
        // else (e.g. `order`) falls back to the generic Apply verb.
        const onlyName = columnUpdates.every((u) => u.field === "name");
        if (onlyName) return "renameColumn";
        return null;
    }
    if (hasTaskUpdates && !hasColumnUpdates && !hasBulkApply) {
        // Single-field task diffs map to specific verbs; mixed-field
        // task diffs are generic updates.
        const fields = new Set(taskUpdates.map((u) => u.field));
        if (fields.size === 1) {
            const [field] = [...fields];
            if (field === "columnId") return "move";
            if (field === "coordinatorId") return "reassign";
        }
        return "update";
    }
    return null;
};

const applyVerbLabel = (proposal: MutationProposal): string => {
    const kind = inferApplyKind(proposal);
    if (!kind) return microcopy.actions.apply;
    const verb = microcopy.mutation.applyVerbs[kind];
    return typeof verb === "string" && verb.length > 0
        ? verb
        : microcopy.actions.apply;
};

/** Derive a human-readable list of field names that will change. */
const buildChangingFields = (proposal: MutationProposal): string => {
    const fields: string[] = [];
    proposal.diff.task_updates?.forEach((u) => {
        const label = taskFieldLabel(u.field);
        if (!fields.includes(label)) fields.push(label);
    });
    proposal.diff.column_updates?.forEach((u) => {
        const label = microcopy.mutation.columnFieldLabel.replace(
            "{field}",
            u.field
        );
        if (!fields.includes(label)) fields.push(label);
    });
    proposal.diff.bulk_apply?.forEach((b) => {
        if (!fields.includes(b.operation)) fields.push(b.operation);
    });
    return fields.join(", ");
};

const MutationProposalCard: React.FC<MutationProposalCardProps> = ({
    proposal,
    onAccept,
    onReject,
    onUndo,
    isLoading,
    title
}) => {
    const rows = buildRows(proposal);
    /*
     * A8 activity ledger: each accepted proposal lands in the session
     * log. When the proposal is `undoable` AND the surface wired a
     * `onUndo` callback we forward that as the ledger's undo so the
     * Revert button delegates to the same backend reversal path. When
     * `onUndo` isn't wired (current production state — the BE reversal
     * endpoint is still a GA blocker) we log the entry without an undo
     * — the Revert button is hidden but the entry remains visible for
     * traceability.
     *
     * We destructure `record` + `remove` to keep the commit effect's
     * dependency array narrow — the full `aiLedger` object is a fresh
     * reference on every render and would otherwise re-fire the
     * countdown effect on each tick (issue #5 in the A8 review).
     */
    const { record: recordLedger, remove: removeLedger } = useAiLedger();

    /**
     * Three-phase lifecycle for the 10-second undo window:
     *   "idle"      — normal accept/reject UI
     *   "countdown" — user clicked Accept; counting down before committing
     *   "committed" — onAccept has been called; card is read-only
     */
    const [phase, setPhase] = useState<"idle" | "countdown" | "committed">(
        "idle"
    );
    const [countdown, setCountdown] = useState(0);
    /*
     * Issue #2 (A8 review): hold the ledger id recorded at commit time
     * AND an "already undone" guard so the in-card Undo button + the
     * ledger Revert button can't fire `onUndo()` twice. The first path
     * to fire clears the ref (so subsequent invocations are no-ops) and
     * removes the ledger entry via `removeLedger(id)`.
     */
    const ledgerIdRef = useRef<string | null>(null);
    const undoFiredRef = useRef(false);

    useEffect(() => {
        if (phase !== "countdown") return;
        if (countdown <= 0) {
            setPhase("committed");
            track(ANALYTICS_EVENTS.AGENT_PROPOSAL_ACCEPTED, {
                id: proposal.proposal_id,
                risk: proposal.risk
            });
            onAccept();
            const hasUndo =
                proposal.undoable === true && typeof onUndo === "function";
            ledgerIdRef.current = recordLedger({
                description: microcopyString(
                    microcopy.aiActivityLog.descriptions.mutationProposalApplied
                ).replace("{description}", proposal.description),
                surface: "mutation-proposal",
                undo: hasUndo
                    ? () => {
                          /*
                           * Ledger Revert path. If the in-card Undo
                           * already fired we skip — the guard flag is
                           * the synchronization between the two button
                           * sites. Otherwise mark fired and delegate to
                           * the parent's reversal flow. The ledger entry
                           * removal is handled by `revert()` in the hook
                           * after this closure resolves.
                           */
                          if (undoFiredRef.current) return;
                          undoFiredRef.current = true;
                          onUndo?.();
                      }
                    : undefined
            });
            return;
        }
        const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => window.clearTimeout(id);
    }, [
        phase,
        countdown,
        onAccept,
        onUndo,
        proposal,
        recordLedger
        // `removeLedger` intentionally omitted: the closure only uses
        // `recordLedger`; the in-card undo handler below captures
        // `removeLedger` separately via the component scope.
    ]);

    const handleAccept = () => {
        setPhase("countdown");
        setCountdown(10);
    };

    const handleReject = () => {
        track(ANALYTICS_EVENTS.AGENT_PROPOSAL_REJECTED, {
            id: proposal.proposal_id,
            risk: proposal.risk
        });
        onReject();
    };

    /**
     * Countdown undo — fires before onAccept is called. Analytics fires here
     * so undo intent is measurable even before the BE undo endpoint lands.
     */
    const handleCountdownUndo = () => {
        setPhase("idle");
        setCountdown(0);
        track(ANALYTICS_EVENTS.AGENT_PROPOSAL_UNDONE, {
            id: proposal.proposal_id,
            risk: proposal.risk
        });
    };

    /**
     * Post-commit undo — delegates to the optional `onUndo` prop, which
     * wires to the BE reversal flow (still a GA-blocker as of v2.1).
     *
     * Issue #2 (A8 review): also drops the ledger entry via
     * `removeLedger(id)` so the activity log doesn't keep a still-live
     * closure that would fire `onUndo()` a second time if the user
     * later opened the dock and clicked Revert. The guard flag makes the
     * sequence idempotent — clicking the in-card Undo, then opening the
     * dock to find no entry, then somehow re-triggering this path can't
     * fire `onUndo` twice.
     */
    const handleCommittedUndo = () => {
        track(ANALYTICS_EVENTS.AGENT_PROPOSAL_UNDONE, {
            id: proposal.proposal_id,
            risk: proposal.risk
        });
        if (undoFiredRef.current) return;
        undoFiredRef.current = true;
        onUndo?.();
        const ledgerId = ledgerIdRef.current;
        if (ledgerId) removeLedger(ledgerId);
    };

    const showCommittedUndo =
        proposal.undoable === true && typeof onUndo === "function";
    const changingFields = buildChangingFields(proposal);
    const heading =
        title ??
        microcopy.mutation.copilotProposes.replace(
            "{description}",
            proposal.description
        );

    /*
     * QW#6 (2026-05 review §Quick Wins): the card is always rendered
     * inline (chat drawer, review-each list) — it is not a modal dialog.
     * `role="alertdialog"` forced screen readers into an alert + dialog
     * announcement that hijacks focus and reads the diff as a
     * notification; for an inline diff card that's the wrong contract.
     * `role="region"` (paired with `aria-label={heading}`) gives the
     * surface a navigable landmark while letting normal reading order
     * resume after the card. If a future surface ever wraps the card in
     * an actual modal, the parent Dialog supplies the `dialog` role and
     * the card stays a `region` inside it.
     */
    return (
        <Wrap role="region" aria-label={heading}>
            <Heading>
                <Typography.Text strong style={{ fontSize: fontSize.base }}>
                    {heading}
                </Typography.Text>
                <CopilotChip tone={riskTone(proposal.risk)} variant="risk">
                    {riskLabel(proposal.risk)}
                </CopilotChip>
                {proposal.undoable && phase === "idle" && (
                    <Tag
                        color="default"
                        style={{ fontWeight: fontWeight.medium }}
                    >
                        {microcopy.mutation.undoable}
                    </Tag>
                )}
            </Heading>
            {rows.length > 0 && (
                <Table
                    columns={[
                        {
                            dataIndex: "field",
                            key: "field",
                            title: microcopy.mutation.diffColumns.field,
                            width: 140
                        },
                        {
                            dataIndex: "from",
                            key: "from",
                            title: microcopy.mutation.diffColumns.current,
                            render: (value) => (
                                <span
                                    style={{
                                        color: "var(--ant-color-error, #EF4444)"
                                    }}
                                >
                                    {value}
                                </span>
                            )
                        },
                        {
                            dataIndex: "to",
                            key: "to",
                            title: microcopy.mutation.diffColumns.proposed,
                            render: (value) => (
                                <span
                                    style={{
                                        color: "var(--ant-color-success, #10B981)"
                                    }}
                                >
                                    {value}
                                </span>
                            )
                        }
                    ]}
                    dataSource={rows}
                    pagination={false}
                    size="small"
                />
            )}

            {/* Countdown undo bar — shown while the 10-second window is open */}
            {phase === "countdown" && (
                <UndoBar role="status">
                    <UndoBarRow>
                        <Typography.Text
                            style={{ flex: 1, fontSize: fontSize.sm }}
                        >
                            {changingFields
                                ? microcopy.mutation.acceptingWillChange.replace(
                                      "{fields}",
                                      changingFields
                                  )
                                : microcopy.mutation.acceptingProposal}
                        </Typography.Text>
                        <Button
                            aria-label={microcopy.mutation.undoCountdownAria.replace(
                                "{seconds}",
                                String(countdown)
                            )}
                            onClick={handleCountdownUndo}
                            size="small"
                        >
                            {microcopy.mutation.undoCountdown.replace(
                                "{seconds}",
                                String(countdown)
                            )}
                        </Button>
                    </UndoBarRow>
                </UndoBar>
            )}

            {/* Normal action row — hidden during countdown / after commit */}
            {phase === "idle" && (
                <>
                    <Space
                        size={space.xs}
                        style={{
                            justifyContent: "flex-end",
                            marginTop: space.sm
                        }}
                        wrap
                    >
                        <Button
                            aria-label={microcopy.a11y.rejectProposal}
                            disabled={isLoading}
                            onClick={handleReject}
                        >
                            {microcopy.actions.cancel}
                        </Button>
                        <Button
                            aria-label={microcopy.a11y.acceptProposal}
                            loading={isLoading}
                            onClick={handleAccept}
                            type="primary"
                        >
                            {applyVerbLabel(proposal)}
                        </Button>
                    </Space>
                    <FooterHint>
                        {microcopy.mutation.undoAvailableAfterAccepting}
                    </FooterHint>
                </>
            )}

            {/*
             * Post-commit phase: the proposal has been applied. The card is
             * otherwise read-only, but if the caller wired `onUndo` AND the
             * proposal is undoable we surface a single Undo affordance so
             * the footer hint ("Undo available after accepting") resolves to
             * an actual visible control. See Bug 2 in
             * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
             */}
            {phase === "committed" && showCommittedUndo && (
                <Space
                    size={space.xs}
                    style={{
                        justifyContent: "flex-end",
                        marginTop: space.sm
                    }}
                    wrap
                >
                    <Button
                        aria-label={microcopy.mutation.undoAriaLabel}
                        disabled={isLoading}
                        onClick={handleCommittedUndo}
                    >
                        {microcopy.mutation.undoLabel}
                    </Button>
                </Space>
            )}
        </Wrap>
    );
};

export default MutationProposalCard;
