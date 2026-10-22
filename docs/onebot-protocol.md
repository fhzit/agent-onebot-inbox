# OneBot protocol notes

The event/action transport here uses only the OneBot v11 wire envelope. NapCat and SnowLuma actions/capabilities must remain in adapters, not the inbox rules.

SnowLuma documents HTTP as `POST /{action}` with `Authorization: Bearer <token>` and a response envelope with `status`, `retcode`, `data`; `retcode=0` signals success even when HTTP status is 200. See https://snowluma.github.io/en/api/index.html.

OneBot v11 defines four communication patterns—HTTP, HTTP POST events, forward WebSocket, and reverse WebSocket. See https://11.onebot.dev/communication/ .

Current server handles reverse WebSocket and inbound HTTP event reporting, plus only `send_private_msg`/`send_group_msg`. It does not implement every action or connection mode. Reverse WS handshake binding, echo response discrimination, provider error envelope handling and shared multi-account behavior should be verified against actual NapCat and SnowLuma versions before production use.
