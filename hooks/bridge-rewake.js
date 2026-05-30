#!/usr/bin/env node
import { connect, ErrorCode } from "nats";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const STATE_FILE = join(homedir(), ".bridge-harness-state.json");
const decoder = new TextDecoder();

function resolveSubject() {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (state.canonicalSubject) {
      process.stderr.write(`[bridge-rewake] Using subject from state file: ${state.canonicalSubject}\n`);
      return state.canonicalSubject;
    }
  } catch {}
  // Fallback: use env var or cwd basename
  const project = process.env.BRIDGE_PROJECT ?? basename(process.cwd());
  const subject = `bridge.${project}.dm.claude-code`;
  process.stderr.write(`[bridge-rewake] State file not found, fallback subject: ${subject}\n`);
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

      // Re-resolve subject on each reconnect in case MCP restarted with new project
      const subject = resolveSubject();
      const sub = nc.subscribe(subject);

      for await (const msg of sub) {
        const payload = decode(msg.data);
        const content = payload.content ?? String(payload);
        const from = payload.from ?? "pi";

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
