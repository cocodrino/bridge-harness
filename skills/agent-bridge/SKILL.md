---
name: agent-bridge
description: >
  Activate and operate the bridge-harness inter-agent comms reliably: report your
  own identity, discover who is online across projects, message any agent by
  identity, and keep your rooms aligned with your git worktree.
  Trigger: When the user says "activa bridge harness", "usa bridge harness",
  "agent bridge", "usa agent bridge", "activa bridge", "usa bridge", or asks who is
  connected on the bridge.
license: MIT
metadata:
  author: cocodrino
  version: "2.0"
---

## When to Use

- The user says **"activa bridge harness"**, **"agent bridge"**, or **"activa bridge"**.
- The user asks **who is connected** / **quién está conectado** on the bridge.
- You need to send to, or coordinate with, another agent (e.g. Pi) over NATS.

## Routing model (read this first)

| Concern | How it works |
|---|---|
| **Direct messages** | **GLOBAL by identity.** `send to: "agent:<agentId>"` reaches that agent across ANY project / git worktree. Subject: `bridge.dm.<agentId>` (no project). This is the reliable way to reach someone. |
| **Discovery** | **GLOBAL.** `list_agents` shows every agent online (last 60s) across all projects, each tagged with its `project`. The native roster is reliable (agents broadcast a `who-there` query on connect and reply with `here`). |
| **Rooms** | **Project-scoped** (`bridge.<project>.room.<room>`). Each git worktree has its own isolated lobby. A room only reaches agents in the same project. |
| **Durability** | DMs are retained by JetStream (~30 min) and redelivered, so the rewake wakes you for every DM. Needs `nats-server -js` (the bundled auto-start does this). |

## Activation Sequence (run in order, every time)

1. **Identify yourself** — call `whoami`. Report `agentId`, `displayName`, `project`.
2. **Check your worktree ↔ room alignment** (see below) and realign if it drifted.
3. **Discover peers** — call `list_agents` (reliable, global). Show the user who is online and where.
4. **Show the comms cheat-sheet** so you never mis-route.

## Worktree drift check (do this at activation and after any `cd`)

`project` (which scopes your rooms) is captured when the agent process starts and does
NOT follow you if you move to a different git worktree. Verify and realign:

```bash
basename "$(git rev-parse --show-toplevel)"   # your CURRENT worktree
```

If that differs from the `project` reported by `whoami`, call:

```
use_bridge  bridge: "<basename-from-above>"
```

DMs are global, so messaging still works even if your room drifts — this only keeps
your room/lobby membership correct.

## Critical Patterns (the hard-won rules)

| Rule | Why |
|------|-----|
| **DM by identity to reach anyone** | `send to: "agent:<agentId>"` is global and durable — it works across projects/worktrees and wakes the peer. Prefer this over rooms for real-time. |
| **Rooms are project-local** | `send to: "room:<project>"` only reaches agents in the *same* project. Use it for a shared lobby, not to reach someone in another worktree. |
| **`read` is pull-based** | You see messages when you `read`. The rewake hook wakes you on incoming DMs (and your project lobby), then you `read`. After any expected exchange, `read`. |
| **`send` warns on no recipient** | NATS "succeeds" at publishing to nobody. If `send` warns the target isn't visible, re-check the agentId with `list_agents`. |
| **NATS must be up (with JetStream)** | Transport is NATS on `localhost:4222`, started with `-js` for durability. If real-time stops, verify NATS first. |

## Comms Cheat-Sheet

```
# Direct message — GLOBAL, durable, wakes the peer (use for real-time):
send  to: "agent:<agentId>"     message: "<text>"

# Room broadcast — your project's lobby only:
send  to: "room:<project>"      message: "<text>"

# Read your pending inbox (pull — nothing arrives passively):
read

# Identity + discovery:
whoami            # agentId, displayName, project, rooms, worktreeHint
list_agents       # everyone online across all projects (reliable)

# Move your rooms to another project (after moving worktrees, or to share a room):
use_bridge  bridge: "<project>"
```

Your DM subject (what wakes you): `bridge.dm.<agentId>`, where
`agentId = claude-code-<ppid>` for Claude Code instances. Under cmux, your
`displayName` includes the surface name (e.g. `Claude Code @ review`) so instances
are distinguishable.

## Optional fallback — application-level "Roll Call"

`list_agents` is the primary, reliable presence source. Only if you suspect the roster
is stale, you can do a manual probe:

```
# Broadcast to the room, then read DM replies:
send to: "room:<project>" message: "WHO_IN? from=<myAgentId>"
# Responders DM back: HERE id=<myAgentId> name=<displayName> project=<project>
```

Dedupe replies by `id`, exclude your own echo, treat non-responders as offline. If you
RECEIVE a `WHO_IN?`, reply by DM with your identity (`agent:<requesterId>`).

## Commands

```bash
# Verify the NATS transport (needs JetStream for DM durability):
lsof -iTCP:4222 -sTCP:LISTEN -P -n     # expect: nats-server LISTEN on 4222
nats-server -js --store_dir /tmp/bridge-harness-js &   # start with JetStream if down
```

## Verification

- After activation you reported your own `agentId` and confirmed your room matches
  your git worktree.
- `list_agents` shows live peers across projects.
- A DM to `agent:<id>` reaches the peer and wakes them; you `read` the reply.
