# bridge-harness

Real-time communication bridge between AI agents running in different harnesses — built on [NATS.io](https://nats.io).

Specifically designed for **Claude Code** (Anthropic CLI) and **Pi** (earendil-works), but the transport layer is agent-agnostic.

---

## Why

Most multi-agent setups require manual coordination: the user copies output from one agent and pastes it into another. `bridge-harness` eliminates that entirely.

Once installed, Claude Code and Pi communicate directly over a local NATS server — no web UI, no intermediary process, no shared filesystem hacks. Messages flow in real-time and agents react automatically.

---

## How it works

```
┌─────────────────┐              ┌─────────────────┐
│   Claude Code   │              │       Pi        │
│                 │              │                 │
│  MCP Server     │◄────────────►│  Pi Extension   │
│  (stdio)        │              │  (native API)   │
└────────┬────────┘              └────────┬────────┘
         │                                │
         │        NATS subjects           │
         │   bridge.{project}.*           │
         └──────────────┬─────────────────┘
                        │
             ┌──────────▼──────────┐
             │    NATS Server      │
             │   localhost:4222    │
             │   (auto-start)      │
             └─────────────────────┘
```

**Claude Code side** — MCP server exposing 4 tools:
- `join_room` — subscribe to a room to receive its messages
- `send` — send a message to a room or agent DM
- `read` — read pending messages from the inbox
- `list_agents` — list active agents (seen in the last 60s)

**Pi side** — TypeScript extension using Pi's native `ExtensionAPI`:
- Connects to NATS on `session_start`
- Delivers incoming messages via `pi.sendMessage({ triggerTurn: true })` — Pi reacts **automatically**, no user prompt needed
- Publishes heartbeats every 30s for presence tracking
- Exposes `agent_bridge` tool for Pi to send messages proactively

**asyncRewake hook** — Claude Code reacts automatically too:
- A background Node.js script listens for incoming NATS messages
- When a message arrives, it exits with code 2 — triggering Claude Code's `asyncRewake` mechanism
- Claude Code wakes up, reads the inbox, and responds — zero user intervention

---

## Subjects

```
bridge.{project}.room.{room}   # room messages
bridge.{project}.dm.{agent}    # direct messages
bridge.{project}.presence      # heartbeats / online status
bridge.{project}.system        # system events
```

`{project}` defaults to `BRIDGE_PROJECT` env var or the current directory name.

---

## Installation

### Prerequisites

- Node.js 18+
- `nats-server` in PATH — install with `brew install nats-server`
- Pi coding agent with extension support

### Claude Code (one command)

```bash
npm install -g @cocodrino/bridge-harness
bridge-harness-setup
```

That's it. The setup command automatically:
- Registers the MCP server in Claude Code
- Configures the asyncRewake hook so Claude Code reacts to incoming messages automatically

Restart Claude Code. The tools `join_room`, `send`, `read`, `list_agents` will be available.

### Pi Extension

```bash
pi install npm:@cocodrino/bridge-harness-pi
```

That's it. Pi downloads the package from npm and loads the extension automatically.

---

## Usage

### Claude Code sending a message to Pi

```
send to: "agent:pi" message: "Review the auth module and report back."
```

Pi wakes up automatically and processes the instruction.

### Pi sending a message to Claude Code

Pi calls the `agent_bridge` tool:

```
agent_bridge action: "send" to: "agent:claude-code" message: "Auth review done. Found 2 issues."
```

Claude Code wakes up automatically (asyncRewake) and reads the message.

### Checking who's online

```
list_agents
→ [{ "agentId": "pi", "lastSeen": 1234567890 }]
```

### CLI for debugging

```bash
# Send a test message
node dist/cli/index.js send --to pi "hello from terminal"

# Watch incoming messages
node dist/cli/index.js read --watch

# List active agents
node dist/cli/index.js agents
```

---

## Advantages over `agent-comms`

| | bridge-harness | agent-comms |
|---|---|---|
| Build step | `tsc` only | Vite + frontend assets |
| Web UI | None (not needed) | Required — causes runtime crash if missing from npm tarball |
| Pi reactivity | Native `triggerTurn: true` | Broken in published version |
| Claude Code reactivity | `asyncRewake` hook | Manual polling |
| Maintenance | Owned by you | External, unmaintained |
| Dependencies | `nats`, `@modelcontextprotocol/sdk`, `zod` | Heavy (Vite, Express, WebSocket server) |
| npm install bug | No | Yes — missing `dist/bridges/user/web/` assets |

---

## Project structure

```
bridge-harness/
├── src/
│   ├── shared/          # NATS subjects, config constants
│   ├── nats-manager/    # Auto-start, health check, cleanup
│   ├── mcp-server/      # MCP server for Claude Code
│   └── cli/             # Debug CLI
├── packages/
│   └── bridge-harness-pi/
│       └── src/index.ts # Pi extension (TypeScript, no build needed)
├── hooks/
│   └── bridge-rewake.js # asyncRewake hook for Claude Code reactivity
└── tests/               # Unit tests (vitest, 25 tests, no NATS required)
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_PROJECT` | `basename(cwd())` | Project name used in NATS subjects |
| `BRIDGE_NATS_URL` | `nats://localhost:4222` | NATS server URL |

---

## Tests

```bash
npm test
```

25 unit tests covering the NATS manager, MCP tools, Pi extension behavior, and the rewake hook. All tests run without a real NATS server.

---

## License

MIT
