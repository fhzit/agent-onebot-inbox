## OneBot service boundary

`OneBotService` provides a small provider-neutral seam for Reverse WS send/revoke operations. It requires a connected peer and a known outgoing message for revoke; it does not yet enforce provider capability metadata, persist message-action/audit records, or support HTTP Action/reply/file flows. Current server routes still contain their existing action code and are not yet delegated to this service. The service unit tests use a protocol fixture, not a live QQ adapter.
