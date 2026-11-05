# AI advisory browser-test feasibility

## Finding

**A real-browser acceptance run is not feasible from the checked-out repository without installing/providing browser tooling.** The repository has Node.js `v26.5.1`, npm `11.17.0`, and a populated `node_modules` tree, so its existing Node tests can run. But `package.json` declares no browser-test script or browser automation dependency; the lockfile has no Playwright, Puppeteer, Selenium, or WebDriver packages; no `playwright` executable or browser binary (`chromium`, `chromium-browser`, `google-chrome`, `firefox`) is available on PATH; and the current user's Playwright/Puppeteer browser cache directories are absent. There is therefore no repo-local route to drive an actual browser as-is. No installation was attempted.

The available UI checks are source/DOM-mock tests, not browser acceptance. `docs/ai-advisory-ui-acceptance.md` already provides a manual matrix (UI-01–UI-15) and explicitly marks every browser result unverified. The browser session used by this audit is not a browser run against the application and does not provide acceptance evidence.

## Blocker and feasible acceptance path

**Precise blocker:** there is neither an installed browser executable nor browser automation tooling/runtime in the repo/environment. The manual matrix also requires a reachable application environment, valid admin authentication, the advisory feature enabled, and suitable test account/data fixtures; those are not supplied by this repository audit.

**Recommended path:** on a controlled QA machine/CI worker, provision a supported browser and Playwright (or another approved browser driver) as an explicit test dependency, then automate the scenarios in `docs/ai-advisory-ui-acceptance.md` against a built app with isolated seeded data and a test admin identity. Keep browser binaries/dependencies out of this audit and do not call DOM mocks acceptance. At minimum, exercise account scoping and empty state, loading/error/retry, same-timestamp pagination without duplicates/skips, text-only rendering of hostile fixture values, keyboard/accessibility status behavior, and the supported deployment path/auth flow. Record build, environment, browser/version, fixture reference, and results; never record credentials, tokens, or message contents. If automation is not added, a tester can execute that same checklist manually in an already provisioned browser and record the evidence.

## Scope and verification

Read-only tooling audit only; no package installation or source changes. The only file created is this feasibility note. Existing tests and the live application were not run for browser acceptance because no browser path is available here.