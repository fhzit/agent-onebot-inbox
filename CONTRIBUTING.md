# Implementation progress

Product work is intentionally incremental; this page records feature boundaries, not roadmap promises.

## Verified base

- OneBot v11 Reverse WebSocket event ingestion and HTTP event endpoint, account-token gated.
- Multiple configured account IDs / QQ self IDs; event routing and stable dedup.
- Message normalization, a minimal account-scoped in-memory inbox, basic read API.
- Guarded direct text/segment send action using OneBot v11 action names.
- MCP stdio and Streamable HTTP read-only tools.
- Initial SQL migration schema only; it is not active persistence until explicitly integrated.

## Current limitations

The service starts without PostgreSQL and is explicitly degraded; restarting loses messages. Delivery was only tested against local fixtures, not real QQ clients. Don't use as a production secretary or for unattended writes. Attachment, contact resolution, history reconciliation, replies, revoke, durable audit, notifications, and UI remain unavailable.

## Running verification

```sh
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Node.js 24+ expected; current verified shell had Node 26 and npm. Install dependencies via `npm install` if pnpm/corepack unavailable, and commit the generated lockfile through normal review.
