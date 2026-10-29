# Production qualification checklist

**Status: not production-qualified.** This checklist distinguishes repository/CI evidence from live deployment evidence. A green unit or CI run is necessary, not proof that PostgreSQL operations, OneBot provider actions, webhook delivery, or disaster recovery work in the target environment. The README identifies the project as Alpha / not suitable for production operation; do not treat the checks below as a production-readiness claim.

## Evidence boundary and current configuration

- [ ] Record the exact commit/image digest, Node 24 version, deployment configuration, migration version, database version, provider name/version, and qualification date.
- [ ] Use a non-production database, QQ/provider account, webhook endpoint and test recipients first. Preserve evidence with secrets and message content redacted.
- [ ] Review `.env.example`, `docker-compose.yml`, `docs/security.md` and `docs/status.md` for the target deployment. Require PostgreSQL (`DATABASE_URL`) for durable runtime features; without it, the service uses volatile memory. Configure strong distinct `API_TOKEN`, per-account OneBot tokens, and externally backed-up `ACCOUNT_ENCRYPTION_KEY` (base64 32 random bytes). Keep `PERMISSIONS_DEFAULT=readonly` and grant `direct` only to explicitly approved test accounts.
- [ ] Deployment uses TLS/reverse-proxy access controls, network isolation, rate limits and restricted database access. Compose's `/health` check is liveness only; independently verify `/ready` and actual DB operations.

## CI / repeatable repository checks (not live-provider qualification)

- [ ] On the exact candidate commit, run `npm ci`, `npm run migrate`, `npm test`, `npm run typecheck`, `npm run build`, and `npm audit --omit=dev`; retain logs and resolve failures.
- [ ] Confirm the `Node CI` workflow completed successfully. It uses Node 24 and PostgreSQL 16, runs migrations and tests, typecheck and build. The separate `CI and container image` workflow runs tests/typecheck/build and dependency audit; on pushes it builds/publishes the image. Confirm the intended image digest was built from the qualified commit.
- [ ] Note the current limitation: tests include fixtures/mocks and configured PostgreSQL CI coverage, but tracker/docs state that live PostgreSQL queue migration/delivery and live provider behavior have not been confirmed. A workflow definition or local test pass is not evidence of a successful CI run or live qualification.

### Candidate smoke verification (staging only)

Run these checks against the exact candidate image in an isolated staging environment before any canary. Record timestamp, commit/image digest, environment, operator, commands, and redacted output. These checks are a minimum smoke gate, not a qualification or substitute for the sections below.

1. Confirm the candidate digest and configuration; verify no production recipients or provider credentials are in use.
2. Start with the intended PostgreSQL configuration. Require `/ready` to report database-connected; `/health` alone is not sufficient.
3. Read back a uniquely identifiable inbound test event and its inbox state, then restart the service and verify persistence.
4. With an explicitly approved test account/recipient only, perform one harmless provider send and verify provider-side receipt plus the persisted result. Do not retry an ambiguous result.
5. Exercise one controlled signed webhook delivery and verify it at the receiver, not only in the application response.
6. Check logs, queue age, DB connectivity, and provider session state; capture the final readings.

**Stop immediately / no-go** on readiness or DB errors, migration uncertainty, unexpected permission expansion, secrets in logs, provider/account mismatch, duplicate or ambiguous send, failed receiver-side webhook verification, missing durable readback, or any unexplained error/backlog. Do not promote or retry sends to “see if it works”; isolate the candidate and reconcile uncertain outcomes first. Passing smoke checks does not change the status below.

## Database migrations and runtime integration

- [ ] Against a disposable PostgreSQL instance matching production, start from an empty database and apply all numbered `migrations/*.sql` via `npm run migrate`. Verify the `schema_migrations` set matches the files and application tables/indexes/constraints exist.
- [ ] Run migrations a second time; verify it is safe and leaves schema/data unchanged. Capture logs and schema diff.
- [ ] Exercise migration from the actual prior production schema snapshot on a clone, including representative existing rows, foreign keys and IDs. Verify row counts, types, indexes and constraints; separately test failure handling/rollback. Never first test a destructive upgrade on the production database.
- [ ] Start the candidate with `DATABASE_URL`; verify `/ready` reports database-connected, then write and read back an inbound test message and associated Inbox state using the API/runtime. Restart and verify durable records remain. Check logs for migration, connection and encryption errors.
- [ ] Verify the deployed DB role has only intended permissions and connection/TLS/network settings. CI's role setup alone does not establish production least privilege.

## Send, revoke and idempotency (requires a real provider for qualification)

- [ ] In a dedicated test account with explicit `direct` permission, send one harmless private test message to an approved recipient. Verify provider receipt, API response, persisted outgoing message and audit outcome where configured. Check that readonly/unauthorized accounts and ambiguous/missing target requests are rejected.
- [ ] Repeat the same request with the same `client_request_id` and identical payload: verify no second provider message and stable/reconciled response. Reuse that ID with changed target/content: verify conflict/rejection.
- [ ] Inject or induce timeout/disconnect after provider acceptance but before local completion. Verify pending/uncertain state blocks automatic resend, the operator can reconcile against provider state, and retry policy does not create a duplicate. Document that idempotency is not exactly-once; PostgreSQL runtime wiring and fixture tests do not prove live behavior.
- [ ] Revoke only a known outgoing test message. Verify provider confirms revoke and record the API outcome. Verify unknown/incoming messages are rejected. Current behavior is limited to known outgoing messages; revoke persistence/audit limitations must be accepted or fixed before relying on it.
- [ ] Test provider rejection, expired credentials, disconnected WS, slow response and restart while a request is pending. Confirm failures are visible and no ambiguous result is represented as definite success.

## Attachment provider E2E (upload and download)

- [ ] Confirm the deployed build supports the intended action. The repository exposes authenticated `get_file` retrieval with account permissions, host allowlist, path sandbox and size bounds; upload/send is implemented but provider/version support is not verified. Provider capability and lifecycle compatibility remain unqualified.
- [ ] On an allowlisted provider test account, upload a benign small file to a controlled private/group target; verify action result, returned `file_id`, sent message, and recipient retrieval/content checksum. Then retrieve an existing provider file through authenticated `GET /api/attachments/:accountId/:fileId` and verify bytes, filename/content headers and size limit.
- [ ] Exercise denied account/permission, non-allowlisted host, traversal/arbitrary URL, oversized file, missing file and provider error. Verify no local path or secret leaks and no unsafe fetch occurs.
- [ ] Test the upload-success/send-failure and ambiguous-send cases. Confirm uploaded orphan handling/operator procedure; current delivery can be uncertain and upload/send is not a provider-independent guarantee. Attachments are not qualified until each supported provider/version passes.

## Webhook / notification delivery

- [ ] In PostgreSQL mode, verify notification settings are encrypted at rest and secrets are redacted in admin reads/logs. Confirm the configured Hermes Generic V2 endpoint, signing secret, preview policy, priority threshold, timeout and bounded retry settings.
- [ ] Use a controlled receiver to verify a real signed notification arrives and validates, including expected payload, signature, duplicate handling and timeout behavior. Exercise 4xx, 429/5xx, network timeout, receiver outage/recovery, worker restart and queue backlog; verify retry/backoff and failure inspection/manual retry. Manual retry is at-least-once and can duplicate an ambiguously delivered notification.
- [ ] Verify the queue/worker survives process restart and database reconnect, and check duplicate/reconciliation behavior with representative load. Test `/api/admin/notifications/test` as configured. Do not equate mocked notifier tests or a successful test-action response with receiver-side delivery.
- [ ] If operating without PostgreSQL, explicitly record that durable notification queueing is disabled and restart loses in-memory settings/state; do not qualify that mode for durable production notifications.

## Backup, restore and rollback

- [ ] Define RPO/RTO, retention, encryption, access control and restore owner. Back up PostgreSQL and the attachment volume (`./data/attachments` in Compose) consistently; back up `ACCOUNT_ENCRYPTION_KEY` separately in a protected secret store. Losing the key makes stored account tokens unrecoverable.
- [ ] Restore a recent backup to an isolated environment, verify checksums/manifest where used, apply the intended migration path, start the service and validate accounts/settings, message readback, attachment retrieval and notification queue state. Record measured RPO/RTO and gaps. A backup archive verifier or restore-plan helper is not a completed restore drill.
- [ ] Test restore with a missing/corrupt attachment, wrong/missing encryption key and database-only restore. Ensure failures are detected and documented, not silently treated as success.
- [ ] Prepare rollback before upgrade: known-good immutable image digest, tested compatible database/attachment backup and migration compatibility plan. Deploy candidate to staging, run smoke checks, then use a canary/maintenance window and monitor `/ready`, errors, DB connections, queue age and provider session state.
- [ ] Define stop/rollback thresholds and operator actions. Do not assume a code/image rollback reverses schema migrations; establish and test a forward-fix or restore procedure for every migration. Never roll back by deleting data or replaying sends blindly.

## Go / no-go record

- [ ] Every applicable check above has dated evidence, named owner and explicit pass/fail/waiver. Waivers identify residual risk and approver.
- [ ] No-go while database migration/readback, real provider send/revoke/idempotency, each required attachment flow, webhook delivery/recovery, or backup restore remains untested. The repository's current documentation reports backup/restore drill and real QQ/provider/webhook E2E as outstanding; this checklist itself does not change that status.
- [ ] Treat helpers and uncommitted worktree additions as unqualified unless separately shown to be included in the deployed candidate and wired into its runtime. In particular, backup/restore inventory or restore-plan helpers, history/idempotency reconciliation helpers, and provider lifecycle controllers are not proof of an operational workflow. Verify each feature's route/owner, persistence, and operator path on the candidate before marking it applicable and passed.
