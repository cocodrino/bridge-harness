#!/usr/bin/env node
import { connect, ErrorCode } from "nats";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const decoder = new TextDecoder();

function resolveSubject() {
  // The hook and the MCP server are both children of the same Claude Code process.
  // Using process.ppid gives us the shared parent PID — unique per Claude Code instance.
  const stateFile = join(homedir(), `.bridge-harness-state-${process.ppid}.json`);
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    if (state.dmSubject) {
      process.stderr.write(`[bridge-rewake] pid=${process.ppid} subject=${state.dmSubject}\n`);
      return state.dmSubject;
    }
  } catch {}
  // Fallback: use env var or cwd basename
  const project = process.env.BRIDGE_PROJECT ?? basename(process.cwd());
  const subject = `bridge.${project}.dm.claude-code`;
  process.stderr.write(`[bridge-rewake] fallback subject=${subject}\n`);
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

      // Re-resolve on each reconnect in case the MCP restarted with a new agentId
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
