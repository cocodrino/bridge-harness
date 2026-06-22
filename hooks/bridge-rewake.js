#!/usr/bin/env node
import { connect, ErrorCode } from "nats";
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

// Both the MCP server and this hook are children of the same Claude Code process.
// Using process.ppid gives us the shared parent PID — unique per Claude Code instance.
// The MCP server generates its agentId as `claude-code-${process.ppid}`, so we can
// derive the exact same subjects here without any files or coordination.
//
// We wake on two subjects: direct messages AND the project room (the default lobby
// the MCP server auto-joins). Both are deterministic from env, so they stay in sync
// with what the MCP actually receives. Rooms joined at runtime via join_room aren't
// covered here — that would need cross-process coordination the project avoids.
function resolveSubjects() {
  const project = resolveProject();
  const agentId = process.env.BRIDGE_AGENT_ID ?? `claude-code-${process.ppid}`;
  const dm = `bridge.${project}.dm.${agentId}`;
  const room = `bridge.${project}.room.${project}`;
  process.stderr.write(`[bridge-rewake] ppid=${process.ppid} dm=${dm} room=${room}\n`);
  return { dm, room, agentId };
}

function decode(data) {
  try {
    return JSON.parse(decoder.decode(data));
  } catch {
    return { from: "unknown", content: decoder.decode(data) };
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  let backoff = 1000;

  while (true) {
    try {
      const nc = await connect({ servers: NATS_URL });
      backoff = 1000;

      const { dm, room, agentId } = resolveSubjects();

      // First qualifying message on either subject wakes Claude. exit(2) tears the
      // process down, so whichever subscription fires first wins the race.
      const waitForWake = async (subject) => {
        const sub = nc.subscribe(subject);
        for await (const msg of sub) {
          const payload = decode(msg.data);
          const from = payload.from ?? "unknown";
          // Ignore our own room broadcasts echoing back via the room subject.
          if (from === agentId) continue;
          const content = payload.content ?? String(payload);

          process.stdout.write(
            JSON.stringify({
              systemMessage: `[Bridge] Mensaje de ${from}: ${content}`,
            }) + "\n"
          );

          await nc.drain();
          process.exit(2);
        }
      };

      await Promise.race([waitForWake(dm), waitForWake(room)]);
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
