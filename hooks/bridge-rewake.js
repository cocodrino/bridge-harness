#!/usr/bin/env node
import { connect, ErrorCode, AckPolicy, RetentionPolicy, StorageType } from "nats";
import { basename } from "node:path";
import { execFileSync } from "node:child_process";

const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const decoder = new TextDecoder();

// Must match getProject() in the MCP server / Pi: each git worktree is its own
// namespace, derived from the worktree root (stable regardless of subdirectory).
function resolveProject() {
  if (process.env.BRIDGE_PROJECT) return process.env.BRIDGE_PROJECT;
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return basename(top);
  } catch {
    // not a git repo, or git unavailable — fall back to the cwd name
  }
  return basename(process.cwd());
}

// The MCP server and this hook are children of the same Claude Code process, so
// process.ppid yields the same agentId (`claude-code-<ppid>`) in both without any
// coordination. DMs are global (`bridge.dm.<agentId>`); rooms are project-scoped.
function resolveSubjects() {
  const project = resolveProject();
  const agentId = process.env.BRIDGE_AGENT_ID ?? `claude-code-${process.ppid}`;
  const dm = `bridge.dm.${agentId}`;              // dynamic id — durable JetStream consumer
  const canonicalDm = `bridge.dm.claude-code`;    // shared alias — core live subscribe only
  const room = `bridge.${project}.room.${project}`;
  process.stderr.write(`[bridge-rewake] ppid=${process.ppid} dm=${dm} room=${room}\n`);
  return { dm, canonicalDm, room, agentId };
}

function decode(data) {
  try {
    return JSON.parse(decoder.decode(data));
  } catch {
    return { from: "unknown", content: decoder.decode(data) };
  }
}

function emitWake(text) {
  process.stdout.write(JSON.stringify({ systemMessage: `[Bridge] ${text}` }) + "\n");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Ensure the DM stream + this agent's durable consumer exist, and return the consumer.
// Returns null if JetStream is unavailable, so the caller falls back to a core subscribe.
async function tryGetDurableConsumer(nc, agentId) {
  try {
    const jsm = await nc.jetstreamManager();
    try {
      await jsm.streams.info("BRIDGE_DM");
    } catch {
      await jsm.streams.add({
        name: "BRIDGE_DM",
        subjects: ["bridge.dm.*"],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        max_msgs_per_subject: 100,
        max_age: 30 * 60 * 1e9, // 30 min in nanoseconds
        max_bytes: 64 * 1024 * 1024,
      });
    }
    const durable = `rewake-${agentId}`;
    try {
      await jsm.consumers.info("BRIDGE_DM", durable);
    } catch {
      await jsm.consumers.add("BRIDGE_DM", {
        durable_name: durable,
        filter_subject: `bridge.dm.${agentId}`,
        ack_policy: AckPolicy.Explicit,
      });
    }
    return await nc.jetstream().consumers.get("BRIDGE_DM", durable);
  } catch (err) {
    process.stderr.write(`[bridge-rewake] JetStream unavailable, using core DM subscribe: ${err.message}\n`);
    return null;
  }
}

async function run() {
  let backoff = 1000;

  while (true) {
    try {
      const nc = await connect({ servers: NATS_URL });
      backoff = 1000;

      const { dm, canonicalDm, room, agentId } = resolveSubjects();

      // Core-NATS live wake: first qualifying message on the subject wakes Claude.
      const waitForWake = async (subject) => {
        const sub = nc.subscribe(subject);
        for await (const msg of sub) {
          const payload = decode(msg.data);
          const from = payload.from ?? "unknown";
          if (from === agentId) continue; // ignore our own room echoes
          const content = payload.content ?? String(payload);
          emitWake(`Mensaje de ${from}: ${content}`);
          await nc.drain();
          process.exit(2);
        }
      };

      // Durable JetStream consumer for our dynamic DM subject: anything that arrived
      // while this hook was between exit and reconnect is redelivered here, so no wake
      // is missed. A short debounce collapses a redelivered backlog into a single wake.
      const durableConsumer = await tryGetDurableConsumer(nc, agentId);
      const waitForDurableDM = async () => {
        const iter = await durableConsumer.consume({ max_messages: 100 });
        const batch = [];
        let armed = false;
        for await (const m of iter) {
          batch.push(m);
          if (!armed) {
            armed = true;
            setTimeout(async () => {
              const first = decode(batch[0].data);
              const from = first.from ?? "unknown";
              emitWake(
                batch.length === 1
                  ? `Mensaje de ${from}: ${first.content ?? ""}`
                  : `${batch.length} mensajes nuevos en tu inbox — usá la tool 'read' del MCP bridge-harness para verlos.`
              );
              for (const mm of batch) mm.ack();
              await nc.flush();
              process.exit(2);
            }, 250);
          }
        }
      };

      const racers = [waitForWake(canonicalDm), waitForWake(room)];
      racers.push(durableConsumer ? waitForDurableDM() : waitForWake(dm));
      await Promise.race(racers);
    } catch (err) {
      const isConnErr =
        err?.code === ErrorCode.ConnectionRefused ||
        err?.code === ErrorCode.Timeout ||
        err?.message?.includes("CONNECTION");

      if (!isConnErr) {
        process.stderr.write(`[bridge-rewake] Error: ${err.message}\n`);
      }

      await sleep(Math.min(backoff, 30_000));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

run();
