# AI advisory UI browser acceptance checklist

**Purpose:** standalone manual browser QA for the admin AI-advisory panel. This checklist distinguishes checked-out source behavior from behavior that still requires a real browser run. It is not a release approval or deployment qualification.

## Evidence status

- **Source inspected:** `public/admin.html`, `scripts/embed-admin.mjs`, `src/admin-page.ts`, `src/admin-ai-advisory-panel.ts`, `src/server.ts`, and focused panel/embed tests.
- **Implemented in checked-out source:** The generated admin HTML includes an account selector, load and load-more buttons, a polite live status, and a results container. On the current page, the inline panel selects an account, requests `/api/ai-advisories` with `account_id` and `limit=50`, sends the bearer token, handles a `before`/`before_message_id` cursor, and creates result nodes with `textContent`. The Node route requires the existing admin authentication, returns 503 when the advisory store is unavailable, validates/allowlists account IDs, and uses composite keyset pagination. Focused tests are DOM mocks/source tests, not browser tests.
- **Not verified:** No real browser session, deployed environment, browser accessibility audit, real database pagination, subpath/reverse-proxy deployment, or end-to-end auth flow was exercised for this checklist. All items below remain **UNVERIFIED** until run and recorded against a specific build/environment. Do not describe source inspection or DOM-mock tests as browser acceptance.

## Run record

Record before testing:

- Build/commit: ____________________
- Environment/base URL: ____________________
- Browser and version: ____________________
- Advisory feature enabled and test account IDs: ____________________
- API/database fixture or test-data reference (no secrets): ____________________
- Tester/date: ____________________

Mark each row **PASS**, **FAIL**, or **BLOCKED** and attach a concise observation/evidence reference. Do not paste tokens, message contents, or secrets into evidence.

## Browser acceptance matrix

| ID | Scenario and procedure | Expected result / pass condition | Source status | Browser result |
|---|---|---|---|---|
| UI-01 | Open admin page while logged out. Inspect advisory panel and controls. | Panel is present; account selection is explicit; no advisory request is made before a user selects an account and requests data. | Source contains controls and does not auto-load advisories. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-02 | Log in with valid admin token; load available accounts and open selector. | Selector contains the accounts returned by the admin UI's account-list request; labels render correctly; no access token is shown. | Source populates selector from `accounts` using escaped option strings. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-03 | Leave account blank and activate “加载建议” (or equivalent localized label). | No API request is sent; status asks the user to select an account; existing results are not presented as belonging to a newly selected account. | Source checks empty selection before fetching. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-04 | Select account A and load when it has no advisory rows. | Request is scoped to account A; empty-state status is shown; load-more is hidden; no stale rows remain. | Source clears the list before non-append load and reports empty response. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-05 | Load an account with records; inspect rendered fields and network request. | Request includes exactly the selected `account_id` and a bounded `limit=50`, uses bearer auth and no-store caching; rows show only label, confidence, model, policy version, message ID and timestamp metadata. | Source implements these request/render fields; server caps/validates pagination. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-06 | Switch from account A with visible rows to account B and load. Also test removing/invalidating the selection if possible. | Old rows are cleared before the new result is displayed; the next request uses only B; no cross-account rows appear. | Source clears on fresh load and uses current selector value. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-07 | Simulate delayed response, then press load/load-more repeatedly. | Controls do not produce duplicate/concurrent page fetches or duplicate appended rows; loading state is announced and actions remain usable afterward. | The exported panel controller has a `busy` guard and disables buttons. The generated inline page script does not visibly disable controls or guard concurrent requests. This discrepancy must be tested against the actual shipped admin page. **Unverified; potential source risk.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-08 | Make the API return an error (e.g. 401, 403, 503, 500) or fail offline; retry after recovery. | Error is communicated without leaking token, SQL, raw response, or message content; user can retry; load-more is hidden when page retrieval fails. | Inline panel catches failures and gives generic status; request uses bearer token. 401 behavior should also be checked with the host page's auth flow. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-09 | With more than one page, traverse all pages. Include several rows sharing the same `created_at` timestamp, and compare the rendered message IDs against a known complete ordered fixture. | Each page sends both `before` and `before_message_id`; equal-timestamp rows are neither skipped nor duplicated; ordering is stable; load-more disappears at the end. | Node store/route source uses composite `(created_at,message_id)` cursor; inline page splits the composite cursor. Focused UI tests do not prove browser traversal or real-DB tie handling. **Browser/DB unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-10 | Use fixture values containing `<script>`, quotes, ampersands, Unicode, and `</script>` in label/model/policy/message ID where accepted by test setup. | Values appear as literal text; no HTML element/script executes; surrounding admin page remains intact. | Inline panel constructs elements and assigns `textContent`; embed helper escapes script-closing `<`. The actual generated document still requires browser verification. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-11 | Keyboard-only: tab to account selector, choose an option, tab to load, activate with Enter/Space, then tab to load-more when available. | Controls have usable focus order and visible focus; native select/buttons work by keyboard; loading/error/empty updates are announced by the status region. | Selector has `aria-label`; status has `aria-live="polite"`; native button/select controls are used. No automated or manual browser keyboard run is recorded. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-12 | Inspect accessibility tree/screen-reader announcement for panel heading, selector, actions, status and result list. | Panel is understandable and operable; status updates are announced; result structure and control names are meaningful; no keyboard trap. | Heading and accessible selector label/status live region exist in HTML; result entries are article elements. No explicit list semantics or browser accessibility audit is evidenced. **Unverified; assess whether semantics need improvement.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-13 | Open admin under the supported root deployment path; inspect actual request URL and auth header. Repeat under the documented reverse-proxy/base-path deployment if supported. | Requests reach the correct API origin/path and retain auth; no root-path assumption breaks the panel under supported deployment. | Both current inline panel and helper form an absolute-root `/api/ai-advisories` path. No configurable base-path handling is evident in this panel source. **Unverified; subpath support is not established.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-14 | Use invalid account ID, disabled advisory feature, and unauthorized/no-token request (direct API or controlled fixture). | API rejects/denies appropriately; no advisory rows leak across accounts; UI shows a safe recoverable error and does not imply empty success. | Server source validates auth and allowlisted account and returns unavailable/validation errors; browser integration not run. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |
| UI-15 | Refresh page, log out, and log in again; inspect panel state and network activity. | No stale advisory data is shown under a different login/account context; a fresh explicit selection/load is required as appropriate. | Host page owns login/logout and panel has page-lifetime DOM state; cross-session browser behavior is not established by focused tests. **Browser unverified.** | ☐ PASS ☐ FAIL ☐ BLOCKED — Notes: |

## Acceptance decision

- **PASS** only when every applicable row has a recorded browser result and no unresolved blocker/risk remains. Document skipped rows and justification.
- **FAIL** if an expected behavior is broken; file a defect with build, browser, steps, and sanitized evidence.
- **BLOCKED** if the environment, feature flag, test data, or supported base-path/auth setup is unavailable. A blocked test is not a pass.
- This checklist covers UI behavior only. It does not accept classifier safety, product consent, migration/database production impact, retention, deployment, or overall feature rollout. Refer to `docs/ai-advisory-acceptance.md` for those separate gates.

**Current conclusion: UI browser acceptance NOT RUN.** Source inspection shows UI wiring in the generated admin page, but no browser run or deployment evidence is available in the checked-out workspace.
