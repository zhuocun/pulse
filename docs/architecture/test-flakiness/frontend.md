# Frontend Jest Flakiness Audit

## Suite shape

- 146 test files / 1055 tests / 146 suites on this branch (`NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles`).
- AGENTS.md still documents the older envelope (~980 tests / 142 suites), so the suite has grown.
- Setup at `src/setupTests.ts`; jsdom environment with project-level test shims.
- Run command: `NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles`.

## Top suspects (highest confidence first)

### 1. `src/components/aiTaskAssistPanel/index.test.tsx:149` — fake-timer state leaked between cases

- Symptom
    - Intermittent timing assertions and order-sensitive behavior when this file runs adjacent to other timer-heavy suites.
- Root-cause hypothesis (cite specific code)
    - The suite used fake timers across the entire describe block and advanced timers without a single helper, making timer lifecycle control inconsistent (`beforeAll` + direct `jest.advanceTimersByTime` usage).
- Proposed fix (concrete diff sketch)
    - Switch to per-test timer ownership and centralize timer advancement:
        - `beforeEach(() => jest.useFakeTimers())`
        - `afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); })`
        - `const advanceBy = (ms) => act(() => jest.advanceTimersByTime(ms))`
- Risk: low

### 2. `src/components/taskModal/index.test.tsx:257` — `Modal.confirm` spy could leak on early assertion failure

- Symptom
    - Follow-up tests can accidentally run with a stale `Modal.confirm` mock if an assertion throws before explicit cleanup.
- Root-cause hypothesis (cite specific code)
    - Three deletion tests restored the spy only at the bottom of the happy path (`confirmSpy.mockRestore()`), not in guaranteed teardown.
- Proposed fix (concrete diff sketch)
    - Wrap each test body in `try/finally` and move `confirmSpy.mockRestore()` to `finally`.
- Risk: low

### 3. `src/pages/project.test.tsx:273` — real `setTimeout` debounce wait races under load

- Symptom
    - Debounce assertion can be timing-sensitive on loaded CI workers because the test used wall-clock delay (`setTimeout(resolve, 400)`).
- Root-cause hypothesis (cite specific code)
    - Real timers and async scheduler jitter made the debounce boundary non-deterministic.
- Proposed fix (concrete diff sketch)
    - Convert to fake timers within the test and drive the debounce deterministically:
        - `jest.useFakeTimers()`
        - `await act(async () => jest.advanceTimersByTime(400))`
        - restore in `finally`.
- Risk: low

### 4. `src/components/aiTaskAssistPanel/agent.test.tsx:180` — suite-level fake timers still shared across tests

- Symptom
    - Potential cross-test coupling in a remote-agent suite with delayed-flag behavior and repeated rerender assertions.
- Root-cause hypothesis (cite specific code)
    - `jest.useFakeTimers()` is enabled in `beforeAll` and disabled in `afterAll`, so pending timers from one case can survive into the next case.
- Proposed fix (concrete diff sketch)
    - Mirror the hardened pattern from `index.test.tsx`: per-test fake timers plus `afterEach` cleanup.
- Risk: low

### 5. `src/utils/hooks/useAgentHealth.test.tsx:216` — timer tick not wrapped in `act`

- Symptom
    - Polling-transition test can miss a state flush on slower workers (or emit React act warnings) when advancing timers.
- Root-cause hypothesis (cite specific code)
    - `jest.advanceTimersByTime(5_000)` is called directly in a hook test that expects state changes from interval-driven effects.
- Proposed fix (concrete diff sketch)
    - Wrap timer movement in `act(() => jest.advanceTimersByTime(5_000))` before asserting poll count / status.
- Risk: low

### 6. `src/components/aiTaskDraftModal/agent.test.tsx:189` — `waitFor` used for synchronous mock-invocation checks

- Symptom
    - Call-count assertions can become over-tolerant (retries hide ordering issues) and introduce avoidable polling delay.
- Root-cause hypothesis (cite specific code)
    - The suite uses `await waitFor(() => expect(start).toHaveBeenCalledTimes(1))` for click-triggered `start` calls that are synchronous at dispatch time.
- Proposed fix (concrete diff sketch)
    - Replace those with immediate assertions after interaction (or a single `findBy*` guard for truly async UI effects), keeping `waitFor` only where DOM/state transitions are asynchronous.
- Risk: medium

## Cross-cutting patterns

- Default `waitFor` usage is widespread: 241 call-sites across 51 files; example `src/utils/hooks/useAgent.test.tsx:92`.
- Timer-heavy tests are concentrated but inconsistent: 22 `advanceTimersByTime` call-sites across 10 files; example `src/components/aiTaskAssistPanel/agent.test.tsx:287`.
- Real wall-clock timeout use remains in test code (3 files); example `src/components/aiTaskAssistPanel/index.test.tsx:305`.
- Strict suites with auto-mocked `useAiEnabled` but no explicit `useAutonomyLevel` override appear in 7 files; example `src/__tests__/uiQuality.strict.test.tsx:48` (currently safe there, but fragile if Board/Ai drawer surfaces are added later).

## Fixes shipped on this branch

- `abee0bc` — `src/pages/project.test.tsx` — replaced real debounce wait with fake-timer + `act` driven advancement.
- `6ddef00` — `src/components/taskModal/index.test.tsx` — guaranteed `Modal.confirm` spy cleanup with `try/finally`.
- `c9941a9` — `src/components/aiTaskAssistPanel/index.test.tsx` — isolated fake timers per test and normalized timer advancement.
