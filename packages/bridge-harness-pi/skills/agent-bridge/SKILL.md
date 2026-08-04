---
name: agent-bridge
description: >
  Operate the bridge-harness inter-agent comms reliably: report your identity,
  discover who is online across projects, message any agent by identity, and keep
  your rooms aligned with your git worktree. Works on any host of the bridge tools
  (Claude Code, Pi, Codex, ...).
  Trigger: When the user says "activa bridge harness", "usa bridge harness",
  "agent bridge", "activa bridge", "usa bridge", or asks who is connected on the bridge.
version: "3"
---

## How to invoke (host-specific)

The bridge exposes the same capabilities everywhere; only the call syntax differs:

- **Claude Code / Codex / MCP hosts** — call the tools directly:
  `whoami`, `send`, `read`, `list_agents`, `join_room`, `who_is_in`, `use_bridge`.
- **Pi** — call the single tool `agent_bridge` with an `action`:
  `agent_bridge action=send to=... message=...`, `agent_bridge action=whoami`, etc.
  (actions: `send`, `read`, `whoami`, `list_agents`, `join_room`, `use_bridge`).

Below, an action like `whoami` means "the `whoami` tool" on Claude/Codex, and
"`agent_bridge action=whoami`" on Pi.

## When to Use

- The user says **"activa bridge harness"**, **"agent bridge"**, or **"activa bridge"**.
- The user asks **who is connected** / **quién está conectado** on the bridge.
- You need to send to, or coordinate with, another agent over NATS.

## Routing model (read this first)

| Concern | How it works |
|---|---|
| **Direct messages** | **GLOBAL by identity.** `send to: "agent:<agentId>"` reaches that agent across ANY project / git worktree. Subject: `bridge.dm.<agentId>`. The reliable way to reach someone. |
| **Discovery** | **GLOBAL.** `list_agents` shows every agent online across all projects, each tagged with its `project`. The roster is reliable (agents broadcast `who-there` on connect and reply with `here`). |
| **Rooms** | **Project-scoped** (`bridge.<project>.room.<room>`). Each git worktree has its own isolated lobby; a room only reaches agents in the same project. |
| **Durability** | DMs are retained by JetStream (~30 min) and redelivered, so you're woken for every DM. Needs `nats-server -js` (the bundled auto-start does this). |

## Activation Sequence (run in order, every time)

1. **Identify yourself** — `whoami`. Report `agentId`, `displayName`, `project`.
2. **Check your worktree ↔ room alignment** (see below) and realign if it drifted.
3. **Discover peers** — `list_agents`. Show the user who is online and where.
4. **Show the comms cheat-sheet** so you never mis-route.

## Worktree drift check (do this at activation and after any `cd`)

`project` (which scopes your rooms) is captured when the agent process starts and does
NOT follow you if you move to a different git worktree. Verify and realign:

```bash
basename "$(git rev-parse --show-toplevel)"   # your CURRENT worktree
```

If that differs from the `project` reported by `whoami`, call `use_bridge` with that
name. DMs are global, so messaging still works even if your room drifts — this only
keeps your room/lobby membership correct.

## Critical Patterns

| Rule | Why |
|------|-----|
| **DM by identity to reach anyone** | `send to: "agent:<agentId>"` is global and durable — works across projects/worktrees and wakes the peer. Prefer over rooms for real-time. |
| **Rooms are project-local** | `send to: "room:<project>"` only reaches agents in the *same* project. Use it for a shared lobby, not to reach someone elsewhere. |
| **`read` is pull-based** | You see messages when you `read`. On Claude a rewake hook wakes you on incoming DMs; on Pi messages are pushed into your turn. Either way, `read` after any expected exchange. |
| **`send` warns on no recipient** | NATS "succeeds" at publishing to nobody. If `send` warns the target isn't visible, re-check the agentId with `list_agents`. |
| **NATS must be up (with JetStream)** | Transport is NATS on `localhost:4222`, started with `-js` for durability. If real-time stops, verify NATS first. |

## Comms Cheat-Sheet

```
# Claude Code / Codex (direct tools):
whoami
list_agents
send   to: "agent:<agentId>"   message: "<text>"     # global DM, durable
send   to: "room:<project>"    message: "<text>"     # your project's lobby only
read
use_bridge  bridge: "<project>"                       # realign rooms / share a room

# Pi (single tool, action=):
agent_bridge action=whoami
agent_bridge action=list_agents
agent_bridge action=send to="agent:<agentId>" message="<text>"
agent_bridge action=read
agent_bridge action=use_bridge bridge="<project>"
```

Your DM subject (what wakes you): `bridge.dm.<agentId>` (`claude-code-<ppid>` for Claude,
`pi-<pid>` for Pi). Under cmux, your `displayName` includes the surface name (e.g.
`Claude Code @ review`) so instances are distinguishable.

## Optional fallback — application-level "Roll Call"

`list_agents` is the primary, reliable presence source. Only if you suspect the roster
is stale, probe manually: `send to: "room:<project>" message: "WHO_IN? from=<myAgentId>"`,
then `read` the `HERE ...` DM replies (dedupe by `id`, exclude your own echo). If you
RECEIVE a `WHO_IN?`, reply by DM to `agent:<requesterId>` with your identity.

## Verification

- You reported your own `agentId` and confirmed your room matches your git worktree.
- `list_agents` shows live peers across projects.
- A DM to `agent:<id>` reaches the peer and wakes them; you `read` the reply.
