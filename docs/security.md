# Security and deployment

## Reverse WebSocket

The shared endpoint is `GET /onebot/v11/ws`; optionally use `/onebot/v11/ws/:accountId`. Each account must have a unique QQ `self_id` and a dedicated high-entropy `access_token`. Configure OneBot to send `Authorization: Bearer <token>` and `X-Self-ID` when supported. The server refuses missing tokens, unknown accounts, and self-ID mismatches. Never disable token enforcement. Use a private network or TLS reverse proxy.

## Event HTTP transport

`POST /onebot/v11/events/:accountId` uses the same account bearer token. Bound body size with `MAX_MESSAGE_BYTES`; enforce request rates and network ACLs at the proxy.

## API

Set a long random `API_TOKEN` as the bootstrap bearer credential. Read endpoints are also authenticated when configured; write endpoints always require it. Set account permission to `direct` only after evaluating the consequences. The default `readonly` denies sends.

The management console does not use the API token. `POST /api/admin/session` exchanges `ADMIN_PASSWORD` for a signed, HttpOnly, SameSite=Strict `aoi_admin_session` cookie (12 h, HMAC-SHA256 over the expiry; `Secure` when the request is HTTPS). Failed logins are throttled per client. When `ADMIN_PASSWORD` is unset the console login is disabled and the API keeps working with `API_TOKEN`.

The console owns API keys (`GET/POST /api/admin/api-keys`, `POST /api/admin/api-keys/:id/revoke`): the plaintext key is returned once, only its SHA-256 hash is stored in `api_keys`, and revocation is immediate. Key management requires the console session, so a leaked API key cannot mint or revoke other keys. API keys and `API_TOKEN` authenticate the API and MCP transports; `API_TOKEN` remains valid as a bootstrap credential until it is rotated out.

## Logs and attachments

The service never logs message bodies. Attachments are not downloaded or exposed by the initial server. Do not expose `data/attachments` publicly. Do not put credentials in `public_config`, source, or issue reports.

## Data

Run migrations deliberately against a backup. PostgreSQL is required for production persistence; the current running service uses an in-memory store and advertises degraded readiness. Protect database backups as private message content.
