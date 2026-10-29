# Attachment upload and send API

`POST /api/messages/send` supports sending one local attachment as an explicit private or group message. It uploads the file to the configured OneBot provider, validates the upload result, then sends a file segment using the provider-returned `file_id`.

## Request

Requires `Authorization: Bearer <API token>` and a JSON body. Example:

```json
{
  "account_id": "main",
  "client_request_id": "upload-2026-01",
  "message_type": "private",
  "target_id": "20002",
  "message": "",
  "attachment_path": "/srv/aoi/outbound/report.pdf"
}
```

`account_id`, `client_request_id`, `message_type` (`private` or `group`), and an explicit `target_id` (or supported private `recipient`) are required by the send route. The account must be enabled and have `permission: "direct"`; other permission levels receive 403. For attachment sends, `attachment_path` must be a non-empty string and `message` must be exactly the empty string. The file is sent as a file segment; text-plus-file is not supported by this attachment form.

The path must be absolute, resolve to a regular file within one of the configured allowed roots, and be no larger than the configured byte limit. Configure `ATTACHMENT_ALLOWED_ROOTS` as a list separated by the platform path delimiter (colon on Linux); only those roots are eligible. `ATTACHMENT_MAX_BYTES` defaults to 10 MiB and accepts integers from 1 through 104857600 (100 MiB). The request body is also subject to the server's normal message-body limit. A path outside the roots, non-file path, or over-limit file is rejected; do not expose arbitrary host paths to API callers.

Upload/send is implemented only for providers with an explicitly declared upload capability. Currently this is NapCat (`upload_group_file` / `upload_private_file`); SnowLuma and unknown providers fail closed until a verified action is added. The API flow expects `status: "ok"`, `retcode: 0`, and a non-empty `data.file_id`, then sends that ID as a OneBot `file` segment to the explicit target. Action parameter compatibility remains provider/version-dependent and is not live-qualified.

## Idempotency and one-shot behavior

Use a unique `client_request_id` for each logical attachment send. The ledger is keyed by account and request ID and binds the ID to message type, target, attachment content SHA-256, file size, and basename. Reusing the ID for different content/target is rejected with HTTP 409 `IDEMPOTENCY_CONFLICT`. A previously completed matching request returns HTTP 200 with `status: "duplicate"` and the stored message rather than uploading/sending again. A request already pending or with an uncertain outcome returns HTTP 409 `IDEMPOTENCY_IN_PROGRESS`; it is not automatically retried. Do not mint a new ID simply to retry an uncertain result, since that can duplicate delivery. Reconcile with the provider/operator first.

The workflow is deliberately single-shot: upload happens once, then send happens once; there is no automatic upload or send retry. Upload errors or malformed upload responses stop before sending. If upload succeeds but send or ledger completion fails, the provider may already hold the uploaded file or may already have delivered the message; the API cannot prove otherwise.

With `DATABASE_URL`/PostgreSQL configured, claims and completed results use `PostgresOutboundIdempotencyStore` and migration `0010_outbound_idempotency.sql`, providing durable cross-process request claims. Pending records remain blocked after process restart and require reconciliation; they do not expire into an automatic retry. Without PostgreSQL, duplicate protection is process-local and bounded by an in-memory capacity; completed entries older than 24 hours may be removed. Restart loses the memory ledger, so a repeated request can upload/send again. Memory mode is not suitable for durable production idempotency.

Idempotency reduces duplicate-dispatch risk; it is not an exactly-once delivery guarantee. A crash or network loss between provider action and ledger completion leaves an uncertain outcome.

## Production and provider limitations

This API's upload adapter assumes the provider action accepts a local absolute path in its `file` parameter. Streamed-upload support and action behavior are provider/server-version dependent; there is no fallback. Unit and API integration tests use fixtures/mocked OneBot peers and verify the request flow, not a real NapCat/SnowLuma installation. Real provider upload/send behavior, live PostgreSQL migration/runtime qualification, and end-to-end production delivery have not been verified. Treat provider response success as the action's reported outcome, not an independent proof that the recipient received the file.
