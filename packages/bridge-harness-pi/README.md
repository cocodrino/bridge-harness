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
| `send` | Send a message to another agent or a room (`to`, `message`) |
| `read` | Drain messages that arrived during the current turn |
| `list_agents` | List agents known on the bridge |
| `whoami` | Show this agent's identity (`agentId`, `displayName`, `project`, `rooms`) |
| `join_room` | Announce presence in a room so other agents see you there (`room`) |

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

## Default room (project lobby)

On connect, both Pi and Claude Code automatically join the room named after the
project. It's the shared lobby where agents are visible to each other by default —
send to it with `to: "room:<project>"`. Pi still *receives* every room via the
wildcard subscription; the lobby is about presence and being reachable without
extra setup.

The project name comes from the **git worktree root** (`basename` of
`git rev-parse --show-toplevel`), so each worktree is its own isolated namespace
and lobby — agents in a worktree don't see agents in the main checkout or other
worktrees. This is stable no matter which subdirectory you launch from. Override
with `BRIDGE_PROJECT` to force agents into the same bridge across worktrees, or
fall back to the cwd name when outside a git repo.

---

## Presence discovery

NATS registry events aren't retained, so an agent only hears the `join` of peers
that connect *after* it. To close that gap, on connect (and on `join_room`) each
agent broadcasts a `who-there` query; every agent that receives it replies with a
`here` event carrying its full identity (`agentId`, `displayName`, `rooms`). This
fills the roster with agents that were already online. Check it with
`agent_bridge { action: "list_agents" }`.

---

## Message delivery

When Pi is idle and a message arrives, it's delivered immediately to wake the agent.

When Pi is in the middle of a turn, the message is buffered instead of interrupting. The agent can pull buffered messages at any point during its turn with `action: "read"`, and anything still buffered is flushed automatically when the turn ends. No messages are dropped.

---

## Remote agents

Pi doesn't have to be on the same machine as Claude Code. Since `nats-server` listens on `0.0.0.0:4222` by default, any machine with network access can connect.

### Same LAN

If Claude Code runs on Machine A with `nats-server`, Pi on Machine B connects to it:

```bash
BRIDGE_NATS_URL=nats://192.168.1.10:4222 pi
```

Make sure port 4222 is open on Machine A's firewall.

### Cloud NATS server

Host a NATS server in the cloud and point both agents to it:

```bash
BRIDGE_NATS_URL=nats://your-server.fly.dev:4222 pi
```

All agents connecting to the same NATS URL and same `BRIDGE_PROJECT` will see each other in `list_agents` and can exchange messages in real-time — regardless of where they're running.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_PROJECT` | git worktree name (falls back to `basename(cwd())`) | Namespace used in NATS subjects. Must match on all agents. Each worktree is isolated by default. |
| `BRIDGE_NATS_URL` | `nats://localhost:4222` | NATS server URL — change this to connect remotely |
| `BRIDGE_AGENT_ID` | `pi-{random4}` | Override the auto-generated agent ID for stable identity across restarts |
| `BRIDGE_DISPLAY_NAME` | `"Pi Agent"` | Human-readable name shown to other agents |

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
