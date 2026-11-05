# AI advisory UI browser test infrastructure findings

## Scope

Independent, read-only audit of the checked-out repository's browser-test infrastructure for the AI advisory admin UI. No dependencies were installed and no source files were changed. This note records tooling availability and what can be tested without changing the dependency set; it is not browser acceptance evidence.

## Findings

- Runtime observed: Node.js `v26.5.1`, npm `11.17.0`; `node_modules` is present.
- `package.json` exposes Node's test runner through `npm test` (`tsx --test tests/*.test.ts`), but declares no browser-test script or browser automation dependency.
- The lockfile has no Playwright, Puppeteer, Selenium/WebDriver, jsdom, or happy-dom package. Runtime resolution checks likewise found none of Playwright, `@playwright/test`, Puppeteer, jsdom, or happy-dom installed.
- No `chromium`, `chromium-browser`, `google-chrome`, or `firefox` executable was found on `PATH`.
- Consequently, a real-browser test cannot be added and executed with the currently available tooling without installing/provisioning additional dependencies and a browser. No install was attempted.

## What is feasible now

The existing Node/tsx test harness can host focused tests for browser-adjacent behavior without new dependencies. In particular, tests can exercise exported UI/controller logic with small hand-written DOM/fetch fakes, assert generated admin markup and embedded-script contracts, and verify that unsafe values are rendered through text APIs. These are unit/contract tests: they do not execute the shipped UI in a browser, validate browser DOM behavior/accessibility, or prove real navigation, rendering, focus, or deployment-path behavior.

Before adding a new test, inspect the existing focused tests (`tests/admin-ai-advisory-panel.test.ts`, `tests/admin-ai-advisory-embed.test.ts`, and related path/acceptance tests) to avoid duplicating coverage. Keep any new tests on the existing `node:test` + `tsx` path; do not represent mocks or source assertions as browser acceptance.

## Recommendation

1. Use the existing test harness for a narrowly scoped regression test only where a concrete gap remains. Mock `fetch` and DOM dependencies explicitly; isolate the test so it restores global state; cover the behavior boundary rather than implementation text where possible.
2. For actual browser acceptance, provision a supported browser plus an approved automation dependency (for example Playwright) in a deliberate CI/QA change, then run the existing manual scenarios in `docs/ai-advisory-ui-acceptance.md` against a built application and isolated data/auth fixture.
3. Record browser/version, build, environment, and sanitized outcomes. Until that setup exists and runs, browser behavior remains unverified.

## Verification boundary

This audit verified package declarations, installed package resolution, runtime versions, and browser executable availability. It did not run project tests, launch the application, or perform a browser acceptance run. Repository state was already broadly modified before this audit; this note is the only file created by this task.