---
name: subagent-orchestrator
description: Operate as an aggressive orchestrator that delegates as many distinct non-trivial side subtasks as practical to parallel subagents with at least medium reasoning when delegation is permitted.
metadata:
  short-description: Aggressive parallel orchestration when allowed
---

# Subagent Orchestrator

Read this skill before starting work when the user asks to use it.

## Purpose

Work as an orchestrator instead of a single-threaded executor:

- decompose work into concrete, bounded subtasks
- keep the critical path moving locally
- proactively delegate as many independent side subtasks as practical in parallel by default on non-trivial tasks
- run subagents for both research tasks (exploration, codebase questions, analysis, design probes) and development tasks (implementation, refactors, bug fixes, test writing, verification)
- act as the reviewer of all subagent output, holding the quality bar before integrating any returned work
- integrate results, verify them, and present a combined outcome

## Limits

This skill does not override system, developer, session, or tool constraints.

- If no subagent launcher is available, ignore this skill and proceed normally.
- Only delegate when the current session or the user explicitly authorizes subagents, delegation, or parallel agent work.
- Do not force delegation on tiny, fully serial, or tightly coupled tasks.
- Do not hand off the immediate blocking step if the next local action depends on that result.
- Do not assume a separate "fast mode" switch exists. If the platform exposes a faster but still capable subagent option, prefer it when it does not undermine task quality.

## Trigger

When delegation is allowed, bias toward using more subagents earlier rather than later.

- Default to delegation for any task that is more than trivial.
- Treat a task as non-trivial if it involves more than one independent question, more than one subsystem, exploration plus implementation, implementation plus verification, or work likely to take more than a few minutes.
- If there are 2 or more independent workstreams, spawn subagents immediately instead of waiting for local exploration to finish.
- If there are 3 or more genuinely distinct side subtasks, prefer running 3 or more subagents in parallel.
- Prefer one subagent per genuinely distinct side subtask instead of batching unrelated work into fewer agents.
- Stay fully local only for genuinely tiny or tightly coupled tasks.

## Operating Mode

1. Before taking action, form a short high-level plan.
2. Identify the immediate blocking step and keep it local.
3. Split the remaining work into independent subtasks with clear scopes — covering both research strands (exploration, lookups, analysis) and development strands (implementation, fixes, tests).
4. Launch subagents early for exploration, codebase questions, verification, or disjoint implementation slices whenever those tracks can progress in parallel.
5. Continue non-overlapping local work while delegated agents run.
6. Avoid idle waiting; wait on agents only when blocked on their output.
7. Act as the reviewer for every returned result: read diffs, validate correctness against the task scope, check for consistency with the rest of the codebase, and reject or send back work that does not meet the bar before integrating it.
8. Integrate accepted work, perform end-to-end verification (typecheck, tests, manual checks as appropriate), and present a combined outcome.

## Model Routing

Match the model tier and reasoning budget to task difficulty. Terms below map across providers — pick whatever the current platform exposes. "Reasoning budget" maps to `reasoning_effort` (OpenAI), extended thinking / thinking budget (Anthropic, Gemini), or equivalent; if the platform exposes no such control, rely on tier choice alone.

**Tier guidance**

- **Lighter sidecar work** (bounded exploration, summarization, lookups): mid-tier model with a moderate reasoning budget.
- **Implementation, integration-sensitive, or risky code paths**: top-tier model with a high reasoning budget.
- Prefer the fastest model that still meets the quality bar; step up to the strongest model only when correctness is at risk.
- Never trade correctness on shared or risky code paths for more parallelism.

**Forbidden tier**

Never delegate to the smallest/distilled variants — `*-mini`, `*-flash`, `*-haiku`-class, or other distilled checkpoints — unless a higher-priority instruction explicitly requires them.

**Subagent config must differ from the orchestrator**

A subagent must never run with the *exact same* model **and** reasoning budget as the orchestrator. Pick the first option in this order that is available and not in the forbidden tier:

1. **Step down one model tier within the same family.** Examples: Opus → Sonnet; top-tier GPT → next-tier non-mini GPT. Keep the reasoning budget appropriate for the subtask.
2. **If the platform only offers the same-model option plus a single dedicated subagent model** (e.g. Cursor, where the choices are "same model + same config" or Composer), pick the dedicated subagent model. Composer is Cursor's own top model and is the only non-identical option there.
3. **If no acceptable lower tier exists**, keep the orchestrator's model but drop the reasoning budget by at least one level (e.g. high → medium, medium → low). Applies when the orchestrator is already at the bottom of the non-distilled tiers (e.g. Sonnet, mid-tier GPT) — stepping further would land in the forbidden tier.
4. **Escalation override.** If the subtask is itself integration-sensitive or risky and steps 1–2 would degrade quality unacceptably, fall back to step 3 instead of stepping down tiers.

The intent: subagents should be cheaper or faster than the orchestrator, but never weaker than the forbidden tier and never identical to the orchestrator.

## Delegation Rules

- Use subagents for both research and development workstreams. Research subagents map the codebase, gather context, and answer questions; development subagents implement, refactor, fix bugs, and add tests within owned scopes.
- Prefer explorer-style agents for specific codebase questions.
- Prefer worker-style agents for bounded implementation tasks with disjoint write scopes.
- Give each delegated task an exact goal, expected output, and owned files or responsibility area when code changes are involved.
- Tell delegated agents they are not alone in the codebase, they must not revert others' changes, and they should adapt to concurrent edits by others.
- Avoid duplicate delegation or speculative delegation that does not materially advance the task.
- Recommend 3 or more subagents on clearly multi-part tasks, and use as many subagents as there are genuinely independent side subtasks when local integration capacity and session or tool constraints allow.
- Reuse an existing agent for follow-up work if its context is still relevant; otherwise start a fresh agent.

## Review Responsibilities

The orchestrator is the final reviewer and quality gate. Subagent output is a draft, not a finished result.

- Read every diff, file change, or research summary a subagent returns. Do not accept work sight-unseen.
- Verify correctness against the original task description: scope, expected output, file ownership, and explicit constraints.
- Check for consistency with surrounding code, existing conventions, and other concurrent subagent edits — reconcile conflicts before integrating.
- Run the relevant quality gates (typecheck, lint, targeted tests, full test suite, manual smoke checks) before declaring a task done.
- If a subagent's output is incomplete, incorrect, or off-scope, send it back with a precise correction prompt or redo the work locally — do not paper over issues.
- Surface unresolved risks, skipped checks, or known gaps explicitly in the final summary to the user.

## Communication Rules

- Briefly tell the user what will stay on the critical path locally and what is being delegated.
- Keep progress updates short and integration-focused.
- If delegation is skipped, explicitly state whether the reason is task size, task coupling, or policy constraints.

## Invocation

This skill is a reusable working preference, not an unconditional global override. Use it by explicitly referencing this skill when starting work, for example:

`[$subagent-orchestrator](subagent-orchestrator/[SKILL.md](http://SKILL.md))`
