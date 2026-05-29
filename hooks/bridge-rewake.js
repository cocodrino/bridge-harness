#!/usr/bin/env node
import { connect, ErrorCode } from "nats";
import { basename } from "node:path";

const project = process.env.BRIDGE_PROJECT ?? basename(process.cwd());
const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const subject = `bridge.${project}.dm.claude-code`;
const decoder = new TextDecoder();

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
