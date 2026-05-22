# Delegation Workflow

Use this reference only when the user explicitly asks for subagents, delegation, or parallel test work. Otherwise keep the work local.

## Contents

- Coordinator Responsibilities
- Sharding Strategy
- Worker Prompt Template
- Conflict Avoidance Rules
- Coordinator Integration
- When To Avoid Delegation

## Coordinator Responsibilities

Before spawning workers:

1. Rebuild context using `SKILL.md` and `coverage-workflow.md`.
2. Run baseline coverage and save the current uncovered-file list.
3. Read existing tests and helpers enough to identify current conventions.
4. Decide whether shared test infrastructure is needed before parallel work starts.
5. Assign one disjoint write set per worker.

Keep local ownership of coordination-sensitive files unless assigning them to exactly one worker:

- `src/setupTests.ts`
- `src/test-utils.tsx`
- `src/test-utils/`
- `src/**/test-utils.*`
- `package.json`
- `package-lock.json`
- `yarn.lock`
- Jest/coverage/CI configuration

If shared helpers are missing and many workers need them, implement the minimal helper locally first, validate it, then delegate test shards that use it. If a worker owns shared helpers, no other worker may edit those files.

## Sharding Strategy

Prefer shards that map to independent source areas and co-located tests:

| Shard                                   | Typical Write Set                                                                                   | Good First Validation        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| Pure utilities and optimistic callbacks | `src/utils/*.test.ts`, `src/utils/optimisticUpdate/*.test.ts`                                       | targeted Jest on those files |
| API and React Query hooks               | `src/utils/hooks/useApi.test.tsx`, `useReactQuery.test.tsx`, `useReactMutation.test.tsx`            | targeted hook tests          |
| Auth and provider hooks                 | `src/utils/hooks/useAuth.test.tsx`, `src/utils/authProvider.test.tsx`, `src/utils/authApis.test.ts` | targeted auth tests          |
| URL/modal/drag hooks                    | `useUrl`, `useTaskModal`, `useProjectModal`, `useDragEnd` tests                                     | targeted hook tests          |
| Shared leaf components                  | `src/components/errorBox`, `status`, `row`, search panels, creators                                 | targeted component tests     |
| Auth forms/pages                        | `loginForm`, `registerForm`, `login`, `register`, `home` tests                                      | targeted RTL tests           |
| Project workflow                        | `project`, `projectList`, `projectModal`, `projectPopover` tests                                    | targeted RTL tests           |
| Board workflow                          | `board`, `column`, `taskModal`, `taskSearchPanel`, DnD wrappers                                     | targeted RTL/hook tests      |
| Entry/routes/mock backend               | `App`, `index`, `routes`, `reportWebVitals`, mock middleware tests                                  | targeted Jest tests          |

Adjust shards from current coverage output. At high coverage, split by uncovered lines instead of broad feature areas.

## Worker Prompt Template

Use a prompt like this, customized with exact paths:

```text
Use the repo-local skill at .agents/skills/react-test-development.

You are one worker in a parallel test-writing effort. You are not alone in the codebase. Do not revert or overwrite edits outside your assigned write set, and do not edit shared helpers unless explicitly assigned.

Goal: add high-quality unit/integration tests for: <source area>.

Read:
- .agents/skills/react-test-development/SKILL.md
- .agents/skills/react-test-development/references/project-map.md if you need app architecture
- .agents/skills/react-test-development/references/test-patterns.md for local testing patterns
- .agents/skills/react-test-development/references/test-inventory.md entries for your assigned files
- existing tests/helpers relevant to your assigned files

Write ownership:
- You may edit/create only: <exact paths or directories>
- Do not edit: src/setupTests.ts, src/test-utils*, package files, lockfiles, or other workers' areas unless explicitly told otherwise.

Validation:
- Run targeted tests for your files.
- If feasible, run coverage for your assigned files or note why not.

Final response:
- List changed paths.
- Summarize behaviors covered.
- Report test commands and results.
- Report any uncovered branches, flaky risks, or product defects found.
```

For code-changing workers, tell them to edit files directly in their workspace and list paths changed in their final answer.

## Conflict Avoidance Rules

- Assign exactly one write owner per test file and source-support file.
- Do not let multiple workers create competing test utility patterns.
- Prefer co-located tests to reduce merge conflicts.
- Keep snapshots out of parallel work unless one worker owns the entire component area.
- Do not add dependencies, scripts, or coverage thresholds from a worker shard.
- Do not modify implementation code unless the assigned task explicitly includes a behavior-preserving testability refactor.
- If a worker discovers a shared-helper need, it should report the need instead of editing shared files outside its write set.

## Coordinator Integration

After workers finish:

1. Review each worker's changed paths and final notes.
2. Inspect diffs for overlapping helpers, duplicate factories, brittle assertions, skipped tests, and accidental implementation changes.
3. Run targeted tests for each merged shard if workers did not already run them in the final workspace.
4. Run full coverage:

```bash
CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text --coverageReporters=json-summary --collectCoverageFrom='src/**/*.{ts,tsx}' --collectCoverageFrom='!src/**/*.d.ts' --collectCoverageFrom='__json_server_mock__/**/*.js'
```

5. Compare coverage against the baseline and choose the next shard from remaining uncovered files.
6. Update or consolidate shared helpers only after seeing all worker output.

## When To Avoid Delegation

Keep work local when:

- Only one or two focused files remain below 100%.
- The next work requires a shared helper or test setup design decision.
- Coverage failures are caused by one cross-cutting config issue.
- The code under test is tightly coupled and likely to create merge conflicts.
- The user did not explicitly ask for parallel/subagent work.
