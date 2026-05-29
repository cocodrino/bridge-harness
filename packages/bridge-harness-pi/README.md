# @cocodrino/bridge-harness-pi

Pi coding agent extension that enables **automatic, real-time communication** with Claude Code — powered by [NATS.io](https://nats.io).

Once installed, Pi reacts to messages from Claude Code without any user prompt. No polling, no manual checking, no copy-paste between terminals. Messages flow in real-time and Pi wakes up on its own.

---

## How it works

This extension integrates with Pi's native `ExtensionAPI`. When Pi starts a session, the extension:

1. Connects to a local NATS server (`localhost:4222`)
2. Subscribes to incoming DMs and room messages
3. When a message arrives, calls `pi.sendMessage({ triggerTurn: true })` — Pi wakes up and processes the message automatically
4. Publishes a presence heartbeat every 30 seconds so Claude Code knows Pi is online

```
┌─────────────────┐         NATS subjects         ┌─────────────────┐
│   Claude Code   │ ──────────────────────────────▶│       Pi        │
│                 │ ◀────────────────────────────── │                 │
│  bridge-harness │    bridge.{project}.dm.pi       │  bridge-harness │
│  (MCP server)   │    bridge.{project}.room.*      │  -pi (this pkg) │
└─────────────────┘    bridge.{project}.presence   └─────────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │    NATS Server      │
                        │   localhost:4222    │
                        └─────────────────────┘
```

---

## Installation

```bash
pi install npm:@cocodrino/bridge-harness-pi
```

That's it. Pi downloads the package from npm and loads the extension automatically on next session start.

> **Prerequisite**: `nats-server` must be running locally.
> Install with: `brew install nats-server && nats-server &`

---

## Pairing with Claude Code

This extension is one half of the bridge. The other half is [`@cocodrino/bridge-harness`](https://www.npmjs.com/package/@cocodrino/bridge-harness), which runs on the Claude Code side.

```bash
# On the Claude Code side
npm install -g @cocodrino/bridge-harness
bridge-harness-setup
```

Once both sides are running, the bridge is live. Claude Code gets tools (`send`, `read`, `list_agents`, `join_room`) and Pi gets the `agent_bridge` tool.

---

## Reactivity

**Pi side (this package):** fully reactive. When Claude Code sends a message, Pi receives it instantly and starts processing — `triggerTurn: true` wakes Pi without any user input.

**Claude Code side:** also reactive with the asyncRewake hook included in `@cocodrino/bridge-harness`. When Pi responds, Claude Code wakes up automatically.

The result: a fully autonomous loop where both agents communicate without the user having to relay messages manually.

---

## The `agent_bridge` tool

Once installed, Pi gets a new tool: `agent_bridge`. Use it to send messages proactively:

| Action | Description |
|---|---|
| `send` | Send a message to Claude Code or a room |

### Example — Pi sends a message to Claude Code

```
agent_bridge
  action: "send"
  to: "agent:claude-code"
  message: "Auth review complete. Found 2 issues in src/auth/middleware.ts"
```

### Example — Pi sends to a room

```
agent_bridge
  action: "send"
  to: "room:venflowapp"
  message: "Deploy ready. All tests passing."
```

---

## NATS subjects

Messages flow through these subjects (where `{project}` is your project name):

| Subject | Purpose |
|---|---|
| `bridge.{project}.dm.pi` | Direct messages to Pi |
| `bridge.{project}.dm.claude-code` | Direct messages to Claude Code |
| `bridge.{project}.room.{room}` | Room messages |
| `bridge.{project}.presence` | Heartbeats and online status |

---

## Message queue

If Pi is in the middle of processing a turn when a message arrives, the extension queues the message and delivers it as soon as the current turn completes. No messages are dropped.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_PROJECT` | `basename(cwd())` | Project name used in NATS subjects. Set this to coordinate both agents on the same project. |
| `BRIDGE_NATS_URL` | `nats://localhost:4222` | NATS server URL |

Set `BRIDGE_PROJECT` to ensure Claude Code and Pi subscribe to the same subjects:

```bash
BRIDGE_PROJECT=venflowapp pi
```

---

## Session lifecycle

| Event | What the extension does |
|---|---|
| `session_start` | Connects to NATS, subscribes to DMs and rooms, publishes `status: active` |
| `agent_end` | Flushes queued messages that arrived during the turn |
| `session_shutdown` | Publishes `status: offline`, drains and closes the NATS connection cleanly |

---

## Multi-agent pipeline

Combined with Claude Code's MCP tools, you can build a deliberation pipeline:

1. Pi orchestrates multiple models (kimi, gemini, deepseek) in parallel via `pi-teams`
2. Pi synthesizes the consensus and sends it to Claude Code via `agent_bridge`
3. Claude Code applies the result using its filesystem and git tools
4. Claude Code reports back to Pi via `send`

Consensus format agreed between the agents:

```json
{
  "consensus": "unified decision",
  "rationale": "why this approach",
  "context": ["src/auth/index.ts", "package.json"],
  "tasks": [{ "id": "T-001", "description": "...", "owner": "claude", "verify": "..." }],
  "risks": ["potential issue"],
  "ask_before": ["git push", "destructive ops"],
  "next_step": "await user approval"
}
```

---

## Troubleshooting

**Pi doesn't react to incoming messages**
- Check that `nats-server` is running: `nats-server &`
- Verify the project name matches on both sides: `BRIDGE_PROJECT=yourproject`
- Restart Pi to reload the extension

**`agent_bridge` tool not available**
- Reinstall: `pi install npm:@cocodrino/bridge-harness-pi`
- Check Pi version supports the current ExtensionAPI

**Messages lost between sessions**
- Expected behavior — NATS pub/sub doesn't persist messages. Messages sent while Pi is offline are dropped. JetStream persistence is planned for a future version.

---

## Links

- **GitHub**: [cocodrino/bridge-harness](https://github.com/cocodrino/bridge-harness)
- **Claude Code package**: [@cocodrino/bridge-harness](https://www.npmjs.com/package/@cocodrino/bridge-harness)
- **Pi gallery**: [pi.dev/packages/@cocodrino/bridge-harness-pi](https://pi.dev/packages/@cocodrino/bridge-harness-pi)

---

## License

MIT © cocodrino
