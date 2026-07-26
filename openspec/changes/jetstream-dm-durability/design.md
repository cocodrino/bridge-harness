## Context

DMs use core NATS pub/sub — no retention. Two processes touch a DM: the **MCP server**
(always online during a session; keeps the in-memory inbox) and the **rewake hook** (a
short-lived process that exits with code 2 to wake Claude, then is restarted). The hook's
exit→restart cycle is a blind spot: DMs arriving in it are missed by the hook (no wake),
though the MCP still stores them. With multiple agents replying at once, ~20% of replies land
in that window. The same no-retention property drops any DM sent while a recipient is offline.

`nats-server` (started by `src/nats-manager/`) and `nats@2.29` both already ship JetStream —
enabling it adds no dependency, only a server flag and an on-disk store.

## Goals / Non-Goals

**Goals:**
- Every DM wakes Claude, including replies that arrive during the hook's restart — with no
  side-channel file.
- A recipient that reconnects within a bounded window receives DMs it missed while offline.
- No change to the `send` path, subjects, or DM payload wire format.
- Bounded disk use via retention limits.

**Non-Goals:**
- Durability for room messages (rooms stay ephemeral on core NATS).
- Cross-session offline replay for the dynamic `claude-code-<ppid>` id (a new session is a new
  id / subject; only the canonical `claude-code` subject could replay across sessions).
- Changing the MCP inbox delivery (it stays on core NATS).

## Decisions

**Decision: Make only the hook a durable JetStream consumer; keep the MCP inbox on core NATS.**
The MCP is always online during a session, so its core subscribe never misses a live message.
The missed-wake bug is purely about the hook's restart gap. A durable consumer for the hook —
whose un-acked messages are redelivered on reconnect — closes exactly that gap.
*Alternative considered:* make the MCP a JetStream consumer too. Rejected for v1: adds ack
bookkeeping and duplicate handling on the inbox for no gain while the session is live.

**Decision: Ack after emitting the wake (ack-then-exit).**
If the hook exited without acking, the message would redeliver forever → infinite wake loop.
If it never acked, ditto. Acking the message it just woke for, while leaving gap-window
messages un-acked, is precisely what yields "redeliver only what was missed."

**Decision: `limits` retention with `max_msgs_per_subject`, not a global message cap.**
Each `bridge.dm.<id>` subject is one recipient. A per-subject cap isolates recipients so a
chatty one cannot evict another's messages. A global `max_age` (30 min) and `max_bytes` (64MB)
are safety bounds. *Alternative considered:* `workqueue` retention (delete on ack) — rejected
because it forbids multiple consumers per subject and would break having both a hook consumer
and potential future consumers.

**Decision: Stream captures `bridge.dm.*`; `send` stays a core publish.**
A JetStream stream stores any message published to its subjects regardless of publisher API,
and core subscribers still receive it live. So the sender needs no change and the MCP inbox
keeps working unchanged.

**Decision: Store dir under `/tmp` (`/tmp/bridge-harness-js`).**
Messages are ephemeral (30-min retention) and agents die on reboot anyway, so surviving a
reboot has no value; `/tmp` self-cleans. *Alternative:* `~/.bridge-harness/js` for reboot
persistence — deferred; not needed for this use case.

## Risks / Trade-offs

- [Redundant wakes when a batch is redelivered one-by-one] → The hook exits per message, so a
  3-message backlog can produce up to 3 wakes; each extra `read` just returns empty. Mitigation:
  optionally use a pull consumer with `fetch(batch)` to wake once per batch (nice-to-have).
- [Disk growth from JetStream store] → Bounded by `max_msgs_per_subject`, `max_age`, and
  `max_bytes`; store lives in self-cleaning `/tmp`.
- [Remote nats-server without JetStream] → If `BRIDGE_NATS_URL` points at a server lacking
  `-js`, stream creation fails. Mitigation: detect and log a clear error; fall back to core
  behavior (best-effort) rather than crash.
- [Breaking wire/behavior change?] → None: subjects, payloads, and the `send` API are unchanged;
  this is additive on the server + hook side. Ships within the 0.2.x line.

## Migration Plan

1. `nats-manager` starts (or re-launches) `nats-server` with `-js --store_dir /tmp/bridge-harness-js`.
   If an existing non-JetStream server is already running, document that it must be restarted.
2. On MCP startup, ensure the `BRIDGE_DM` stream exists (create if missing; idempotent).
3. Switch the hook to a durable consumer; remove any file-based interim mechanism (already reverted).
4. Rollback: revert the hook to core subscribe and stop passing `-js`. No data migration needed
   (the stream is ephemeral).

## Resolved Decisions (were open questions)

**Pull consumer for the hook.** The hook uses a durable pull consumer and `fetch(batch)`, so a
backlog that built up during the restart is drained in one grab and produces a single wake,
instead of a push consumer's one-wake-per-message (which yields redundant empty reads).

**Durable consumer bound to the dynamic `bridge.dm.<agentId>` only.** That is the subject
agents actually target (they read the exact id from `list_agents`), and it is per-session so
there is no contention. The canonical `bridge.dm.claude-code` alias stays a plain core-NATS
live subscribe (no durability): a durable on the shared alias would make multiple Claude
sessions compete for the same messages (each delivered once), which breaks the multi-agent case.
