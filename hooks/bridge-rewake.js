#!/usr/bin/env node
import { connect, ErrorCode } from "nats";
import { basename } from "node:path";

const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const decoder = new TextDecoder();

// Both the MCP server and this hook are children of the same Claude Code process.
// Using process.ppid gives us the shared parent PID — unique per Claude Code instance.
// The MCP server generates its agentId as `claude-code-${process.ppid}`, so we can
// derive the exact same subject here without any files or coordination.
function resolveSubject() {
  const project = process.env.BRIDGE_PROJECT ?? basename(process.cwd());
  const agentId = process.env.BRIDGE_AGENT_ID ?? `claude-code-${process.ppid}`;
  const subject = `bridge.${project}.dm.${agentId}`;
  process.stderr.write(`[bridge-rewake] ppid=${process.ppid} subject=${subject}\n`);
  return subject;
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

      const subject = resolveSubject();
      const sub = nc.subscribe(subject);

      for await (const msg of sub) {
        const payload = decode(msg.data);
        const content = payload.content ?? String(payload);
        const from = payload.from ?? "unknown";

        process.stdout.write(
          JSON.stringify({
            systemMessage: `[Bridge] Mensaje de ${from}: ${content}`,
          }) + "\n"
        );

        await nc.drain();
        process.exit(2);
      }
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
