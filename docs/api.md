# API contract (current subset)

All request bodies are JSON; errors use `{error:{code,message,retryable}}`.

- `GET /health`: liveness only.
- `GET /ready`: degraded until durable dependencies are wired.
- `GET /metrics`: basic counters.
- `GET /api/accounts`: `Authorization: Bearer API_TOKEN`; account secrets are omitted.
- `GET /api/messages?account_id=&type=&sender=&priority=&at_me=&keyword=&since=&until=&offset=&limit=`: authenticated; filtered in-memory query. Limit max 200 and returns total/has_more metadata.
- `GET /api/summary?account_id=&since=`: authenticated; `since` is an ISO timestamp.
- `POST /api/messages/send`: authenticated; requires explicit account ID, message_type private/group, target_id, text/segments, client_request_id. Account must be `permission=direct`. Calls `send_private_msg` or `send_group_msg` and only stores response after provider success. In-memory idempotency is not concurrency-safe and must not be relied on for production.
- `POST /api/messages/revoke`: authenticated; requires explicit enabled `account_id` and OneBot v11 int32 `message_id` (integer JSON value or decimal integer string; exponent, fractional, and out-of-range values are rejected). Account must be `permission=direct`; only IDs of known outgoing messages in that account's in-memory store are allowed. Sends `delete_msg` over the account's active Reverse WS and returns the exact OneBot response as `provider_response` only on `status=ok, retcode=0`; provider failures return 502 and are never reported as success. No revoke idempotency/audit persistence is implemented.
- `POST /onebot/v11/events/:accountId`: per-account bearer token required; request body is a OneBot event.
- `POST /api/messages/mark_processed` / `POST /api/messages/dismiss`: authenticated; requires `message_id`. Updates in-memory Agent state only and does not mark QQ read.
- `POST /mcp`: Streamable HTTP MCP, API bearer token. Includes inbox read/search/context/status plus Agent state mark/dismiss tools.

`message_id` accepts an integer JSON number or a base-10 integer string that fits signed int32; exponent, decimal, and out-of-range forms are rejected.
