## Why

Direct messages ride on core NATS (fire-and-forget, no retention). The rewake hook that
wakes Claude is single-shot: it exits on each message and has a brief blind spot while it
restarts. When several agents reply at once, a reply can land in that window and never wake
Claude (~20% of the time the user must manually say "the agent already replied"). The same
lack of retention means a message sent while the recipient is offline is lost forever. Both
problems have the same root cause — no durability — and the fix is native to the NATS server
we already run: JetStream.

## What Changes

- Enable **JetStream** on the managed `nats-server` (`-js --store_dir /tmp/bridge-harness-js`).
- Create (idempotently, on startup) a JetStream stream **`BRIDGE_DM`** capturing `bridge.dm.*`,
  with `limits` retention: `max_msgs_per_subject: 100`, `max_age: 1800s` (30 min),
  `max_bytes: 64MB`, file storage.
- Change the **rewake hook** from a core subscribe to a **durable JetStream consumer** on
  `bridge.dm.<agentId>` (+ legacy `claude-code`), acking each message right after it emits
  the wake. Messages that arrive during the hook's restart go un-acked and are **redelivered
  on reconnect**, so no wake is ever missed — with no side-channel file.
- Remove the interim `/tmp/agent-bridge-<agentId>.txt` file mechanism (already reverted).
- The **MCP inbox stays on core NATS** (it is always online during a session).
- The **`send` tool does not change**: a core publish to `bridge.dm.*` is captured by the
  stream automatically.
- Scope: **DMs only.** Rooms stay on core NATS (ephemeral lobby).

No new dependencies: JetStream ships inside the same `nats-server` binary and the same
`nats@2.29` client already in use.

## Capabilities

### New Capabilities
- `message-durability`: DMs are retained by a JetStream stream and redelivered to a durable
  consumer, guaranteeing the rewake hook wakes Claude for every DM (including those that
  arrive during its restart) and that a recipient reconnecting within the retention window
  receives messages it missed while offline.

### Modified Capabilities
<!-- None: no existing openspec/specs capabilities change their requirements. -->

## Impact

- **`src/nats-manager/`**: start `nats-server` with `-js --store_dir /tmp/bridge-harness-js`;
  ensure the `BRIDGE_DM` stream exists (idempotent).
- **`hooks/bridge-rewake.js`**: replace the core DM subscribe with a durable JetStream
  consumer (ack-after-wake); keep the project-room wake on core NATS.
- **`src/mcp-server/`**: unchanged inbox path; may host the stream-ensure call at startup.
- **Runtime**: `nats-server` now writes to a JetStream store dir on disk (bounded by retention).
  A remote/cloud `nats-server`, if used, must also have JetStream enabled.
- No changes to the `send` path, subjects, or the wire format of DM payloads.
