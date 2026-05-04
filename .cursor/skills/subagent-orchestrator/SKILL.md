---
name: subagent-orchestrator
description: Orchestrates parallel subagents instead of running tasks single-threaded — decomposes the task, delegates independent research and development slices (exploration, analysis, implementation, fixes, tests, verification) to subagents with model and reasoning parameters set explicitly on every call, then reviews returned work as the quality gate before integrating. Use when the user authorizes subagents or asks to "parallelize", "orchestrate", "delegate", or "run agents in parallel"; when the task has 2+ independent workstreams or 3+ distinct subtasks; when it combines exploration with implementation, or implementation with verification; or when it is likely to take more than a few minutes. On Cursor, picks Composer for every subagent call. Do NOT use when no subagent launcher is available, when subagents are not authorized, or for tiny, fully serial, or tightly coupled tasks.
---

# Subagent Orchestrator

## Role

Work as an orchestrator, not a single-threaded executor. Decompose the task, keep the critical path local, delegate every other independent slice — research or development — to parallel subagents, then review and integrate what they return.

## When to delegate

Only delegate when the session or user authorizes subagents. If no subagent launcher exists, ignore this skill. If the platform exposes a faster-but-still-capable subagent option, prefer it when it does not hurt quality.

When delegation is allowed, default to it. A task is worth delegating if any of these are true:

- it spans more than one independent question or subsystem
- it combines exploration with implementation, or implementation with verification
- it is likely to take more than a few minutes
- it has 2+ independent workstreams or 3+ distinct side subtasks

Stay local for genuinely tiny or tightly coupled work, and for the immediate blocking step whose result the next local action depends on.

Prefer one subagent per distinct subtask. Bias toward spawning earlier rather than waiting for local exploration to finish. On clearly multi-part tasks, run 3+ subagents in parallel, up to the limit of independent slices and platform constraints.

## How to delegate

1. Form a short plan and identify the immediate blocking step to keep local.
2. Split the rest into bounded subtasks across both research strands (exploration, lookups, analysis) and development strands (implementation, fixes, tests, verification).
3. For each subtask, give the subagent: the exact goal, the expected output, the owned files or scope, and a note that it is not alone in the codebase — it must adapt to concurrent edits and never revert other agents' work.
4. Launch in parallel. Continue non-overlapping local work while subagents run; only block on a subagent when its output is the next dependency.
5. Reuse a still-relevant agent for follow-up work; otherwise start fresh.

Avoid duplicate or speculative delegation that does not materially advance the task.

## Model selection

Match model and reasoning budget to subtask difficulty. Map the terminology to whatever the platform exposes — `model`, `subagent_type`, `reasoning_effort`, extended thinking / thinking budget, etc.

**Always set these parameters explicitly on every subagent call.** Never accept the platform default: it can route to a forbidden tier, silently downgrade reasoning, or mirror the orchestrator's own config.

Tier guidance:

- Lighter sidecar work (bounded exploration, summarization, lookups): mid-tier model, moderate reasoning budget.
- Implementation, integration-sensitive, or risky code paths: top-tier model, high reasoning budget.
- Pick the fastest model that still meets the quality bar; escalate only when correctness is at risk.

Forbidden tier: never use the smallest/distilled variants (`*-mini`, `*-flash`, `*-haiku`-class) unless a higher-priority instruction requires them.

The subagent must never run with the *exact same* model **and** reasoning budget as the orchestrator. Pick the first option below that is available and not in the forbidden tier:

1. Step down one tier in the same family (Opus → Sonnet; top-tier GPT → next-tier non-mini GPT). Keep the reasoning budget appropriate for the subtask.
2. On Cursor, choose Composer.
3. If no acceptable lower tier exists, keep the orchestrator's model but drop the reasoning budget by at least one level (e.g. high → medium).
4. Escalation override: if the subtask itself is integration-sensitive and steps 1–2 would degrade quality unacceptably, fall back to step 3.

Intent: subagents cheaper or faster than the orchestrator, never weaker than the forbidden tier, never identical to the orchestrator.

## Review

The orchestrator is the final reviewer and quality gate. Subagent output is a draft.

- Read every diff and research summary; do not accept work sight-unseen.
- Verify against the original goal: scope, expected output, ownership, constraints.
- Reconcile conflicts with surrounding code, conventions, and other concurrent subagent edits.
- Run the relevant quality gates (typecheck, lint, targeted tests, full suite, manual smoke checks) before declaring a task done.
- If output is incomplete, incorrect, or off-scope, send it back with a precise correction prompt or redo it locally — do not paper over.
- Surface unresolved risks, skipped checks, or known gaps explicitly in the final summary.

## Communication

- Briefly tell the user what stays local on the critical path and what is being delegated.
- Keep progress updates short and integration-focused.
- If delegation is skipped, state whether the reason is task size, coupling, or policy.

## Invocation

This skill is a reusable working preference, not an unconditional override. Reference it explicitly when starting work.
