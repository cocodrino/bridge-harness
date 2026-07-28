---
name: agent-bridge
description: Use when the user says "activa bridge harness", "usa bridge harness", "agent bridge", "usa agent bridge", "activa bridge", "usa bridge", asks who is connected on the bridge, or you need to coordinate with another agent (e.g. Claude Code) over the NATS bridge-harness. Reports your identity, discovers who is online across projects, messages agents by identity, and keeps your rooms aligned with your git worktree.
version: 2
created: 2026-06-17
updated: 2026-07-28
---

## When to Use

- The user says **"activa bridge harness"**, **"agent bridge"**, or **"activa bridge"**.
- The user asks **who is connected** / **quién está conectado** on the bridge.
- You need to send to, or coordinate with, another agent (e.g. Claude Code) over NATS.

On Pi, all bridge actions go through the single **`agent_bridge`** tool.

## Routing model (read this first)

| Concern | How it works |
|---|---|
| **Direct messages** | **GLOBAL by identity.** `agent_bridge action=send to="agent:<agentId>"` reaches that agent across ANY project / git worktree. Subject: `bridge.dm.<agentId>`. This is the reliable way to reach someone. |
| **Discovery** | **GLOBAL.** `agent_bridge action=list_agents` shows every agent online across all projects, each tagged with its `project`. The roster is reliable (agents broadcast `who-there` on connect and reply with `here`). |
| **Rooms** | **Project-scoped** (`bridge.<project>.room.<room>`). Each git worktree has its own isolated lobby; a room only reaches agents in the same project. |
| **Delivery** | Pi is **push-based**: an incoming message is delivered straight into your turn and you react automatically — no polling. Use `read` to pull messages buffered while you were mid-turn. |

## Activation Sequence (run in order, every time)

1. **Identify yourself** — `agent_bridge action=whoami`. Report `agentId`, `displayName`, `project`.
2. **Check your worktree ↔ room alignment** (see below) and realign if it drifted.
3. **Discover peers** — `agent_bridge action=list_agents`. Show the user who is online and where.
4. **Show the comms cheat-sheet** so you never mis-route.

## Worktree drift check (do this at activation and after any `cd`)

`project` (which scopes your rooms) is captured when the extension starts and does NOT
follow you if you move to a different git worktree. Verify and realign:

```bash
basename "$(git rev-parse --show-toplevel)"   # your CURRENT worktree
```

If that differs from the `project` in `whoami`, run:

```
agent_bridge  action=use_bridge  bridge="<basename-from-above>"
```

DMs are global, so messaging still works even if your room drifts — this only keeps
your room/lobby membership correct.

## Critical Patterns

| Rule | Why |
|------|-----|
| **DM by identity to reach anyone** | `to="agent:<agentId>"` is global — works across projects/worktrees and wakes the peer. Prefer this over rooms for real-time. |
| **Rooms are project-local** | `to="room:<project>"` only reaches agents in the *same* project. Use it for a shared lobby, not to reach someone elsewhere. |
| **You react automatically** | Incoming DMs are pushed into your turn — you don't poll. Use `action=read` only to pull messages that arrived while you were busy in a turn. |
| **`send` warns on no recipient** | NATS "succeeds" at publishing to nobody. If the result warns the target isn't visible, re-check the agentId with `list_agents`. |
| **NATS must be up (with JetStream)** | Transport is NATS on `localhost:4222`, started with `-js` for DM durability. If real-time stops, verify NATS first. |

## Comms Cheat-Sheet

```
# Direct message — GLOBAL, wakes the peer (use for real-time):
agent_bridge  action=send  to="agent:<agentId>"  message="<text>"

# Room broadcast — your project's lobby only:
agent_bridge  action=send  to="room:<project>"   message="<text>"

# Pull messages buffered during your turn:
agent_bridge  action=read

# Identity + discovery:
agent_bridge  action=whoami        # agentId, displayName, project, rooms, worktreeHint
agent_bridge  action=list_agents   # everyone online across all projects

# Move your rooms to another project (after moving worktrees, or to share a room):
agent_bridge  action=use_bridge  bridge="<project>"
```

Your DM subject: `bridge.dm.<agentId>`, where `agentId = pi-<pid>` for Pi instances.
Under cmux, your `displayName` includes the surface name (e.g. `Pi Agent @ review`)
so instances are distinguishable.

## Optional fallback — application-level "Roll Call"

`list_agents` is the primary, reliable presence source. Only if you suspect the roster
is stale, do a manual probe:

```
agent_bridge action=send to="room:<project>" message="WHO_IN? from=<myAgentId>"
# Responders DM back: HERE id=<myAgentId> name=<displayName> project=<project>
```

Dedupe replies by `id`, exclude your own echo, treat non-responders as offline. If you
RECEIVE a `WHO_IN?`, reply by DM to `agent:<requesterId>` with your identity.

## Verification

- After activation you reported your own `agentId` and confirmed your room matches
  your git worktree.
- `list_agents` shows live peers across projects.
- A DM to `agent:<id>` reaches the peer and wakes them.
