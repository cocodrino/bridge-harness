#!/usr/bin/env node
import { connect } from "nats";
import { getProject, NATS_URL, PRESENCE_TTL_MS } from "../shared/config.js";
import { subjects } from "../shared/subjects.js";
import { checkNatsRunning } from "../nats-manager/index.js";

async function requireNats(): Promise<void> {
  if (!(await checkNatsRunning())) {
    process.stderr.write(
      "✗ NATS is not running on localhost:4222\n" +
      "  Start it with: nats-server &\n" +
      "  Or set BRIDGE_NATS_URL to point to another server.\n"
    );
    process.exit(1);
  }
}

const project = getProject();
const sub = subjects;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(data: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(data));
}

function decode(data: Uint8Array): unknown {
  return JSON.parse(decoder.decode(data));
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString();
}

const [, , command, ...rest] = process.argv;

async function cmdSend(args: string[]) {
  const roomIdx = args.indexOf("--room");
  const toIdx = args.indexOf("--to");
  const message = args[args.length - 1];

  if (!message) {
    console.error("Usage: bridge send --room <room> <msg> | --to <agent> <msg>");
    process.exit(1);
  }

  await requireNats();
  const nc = await connect({ servers: NATS_URL });

  let subject: string;
  let dest: string;

  if (roomIdx !== -1) {
    dest = args[roomIdx + 1];
    subject = sub.room(project, dest);
  } else if (toIdx !== -1) {
    dest = args[toIdx + 1];
    subject = sub.dm(project, dest);
  } else {
    console.error("Specify --room <room> or --to <agent>");
    process.exit(1);
  }

  nc.publish(subject, encode({ from: "cli", content: message, timestamp: Date.now() }));
  await nc.flush();
  await nc.close();
  console.log(`✓ Sent to ${dest}: ${message}`);
}

async function cmdRead(args: string[]) {
  const watch = args.includes("--watch");

  await requireNats();
  const nc = await connect({ servers: NATS_URL });
  const inbox = nc.subscribe(sub.dm(project, "cli"));

  if (watch) {
    console.log("Watching for messages (Ctrl+C to stop)...\n");
    for await (const msg of inbox) {
      try {
        const payload = decode(msg.data) as { from: string; content: string; timestamp?: number };
        console.log(`[${formatDate(payload.timestamp ?? Date.now())}] ${payload.from}: ${payload.content}`);
      } catch {}
    }
  } else {
    await nc.flush();
    // Drain buffered messages with a short window
    const messages: unknown[] = [];
    const timer = setTimeout(() => inbox.unsubscribe(), 300);
    for await (const msg of inbox) {
      try {
        messages.push(decode(msg.data));
      } catch {}
    }
    clearTimeout(timer);
    await nc.close();
    if (messages.length === 0) {
      console.log("No pending messages.");
    } else {
      console.log(JSON.stringify(messages, null, 2));
    }
  }
}

async function cmdAgents() {
  await requireNats();
  const nc = await connect({ servers: NATS_URL });

  const agentMap = new Map<string, { lastSeen: number; status: string }>();
  const presenceSub = nc.subscribe(sub.presence(project));

  // Collect presence messages for 500ms
  const timer = setTimeout(() => presenceSub.unsubscribe(), 500);
  for await (const msg of presenceSub) {
    try {
      const payload = decode(msg.data) as { agent: string; status: string };
      agentMap.set(payload.agent, { lastSeen: Date.now(), status: payload.status });
    } catch {}
  }
  clearTimeout(timer);
  await nc.close();

  const now = Date.now();
  const active = [...agentMap.entries()]
    .filter(([, v]) => now - v.lastSeen < PRESENCE_TTL_MS && v.status !== "offline")
    .map(([id, v]) => ({ agent_id: id, status: v.status, last_seen: formatDate(v.lastSeen) }));

  if (active.length === 0) {
    console.log("No active agents found.");
    return;
  }

  const col = { id: 15, status: 10, seen: 30 };
  console.log(
    "AGENT_ID".padEnd(col.id) + "STATUS".padEnd(col.status) + "LAST_SEEN"
  );
  console.log("-".repeat(col.id + col.status + col.seen));
  for (const a of active) {
    console.log(
      a.agent_id.padEnd(col.id) + a.status.padEnd(col.status) + a.last_seen
    );
  }
}

switch (command) {
  case "send":
    cmdSend(rest).catch((e) => { console.error(e); process.exit(1); });
    break;
  case "read":
    cmdRead(rest).catch((e) => { console.error(e); process.exit(1); });
    break;
  case "agents":
    cmdAgents().catch((e) => { console.error(e); process.exit(1); });
    break;
  default:
    console.log("Usage: bridge <send|read|agents> [options]");
    process.exit(1);
}
