#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, type NatsConnection } from "nats";
import { z } from "zod";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  getProject,
  NATS_URL,
  PRESENCE_TTL_MS,
  generateAgentId,
  getDisplayName,
} from "../shared/config.js";
import { subjects } from "../shared/subjects.js";
import { type AgentPresence, type RegistryEvent } from "../shared/types.js";
import { ensureNats } from "../nats-manager/index.js";

// Per-PPID state file: each Claude Code instance gets its own file
// process.ppid is the PID of the Claude Code process that spawned this MCP server
const STATE_FILE = join(homedir(), `.bridge-harness-state-${process.ppid}.json`);

function writeStateFile(project: string, agentId: string) {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ project, agentId, dmSubject: `bridge.${project}.dm.${agentId}`, startedAt: Date.now() }, null, 2),
    "utf8"
  );
}

function deleteStateFile() {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch {}
}

interface InboxMessage {
  from: string;
  content: string;
  timestamp: number;
}

const inbox: InboxMessage[] = [];
const agentPresence = new Map<string, AgentPresence>();
const activeSubscriptions = new Set<string>();
let nc: NatsConnection;

const project = getProject();
const agentId = generateAgentId("claude-code");
const displayName = getDisplayName("Claude Code");
const joinedAt = Date.now();

const codec = new TextEncoder();
const decoder = new TextDecoder();

function encode(data: unknown): Uint8Array {
  return codec.encode(JSON.stringify(data));
}

function decode(data: Uint8Array): unknown {
  return JSON.parse(decoder.decode(data));
}

function publishRegistry(event: Omit<RegistryEvent, "agentId" | "displayName" | "timestamp">) {
  nc.publish(
    subjects.registry(project),
    encode({ ...event, agentId, displayName, timestamp: Date.now() } satisfies RegistryEvent)
  );
}

function applyRegistryEvent(event: RegistryEvent) {
  if (event.agentId === agentId) return;

  if (event.type === "join") {
    agentPresence.set(event.agentId, {
      agentId: event.agentId,
      displayName: event.displayName,
      rooms: new Set(),
      joinedAt: event.timestamp,
      lastSeen: event.timestamp,
    });
  } else if (event.type === "leave") {
    agentPresence.delete(event.agentId);
  } else if (event.type === "room-join" && event.room) {
    const agent = agentPresence.get(event.agentId);
    if (agent) agent.rooms.add(event.room);
  } else if (event.type === "room-leave" && event.room) {
    const agent = agentPresence.get(event.agentId);
    if (agent) agent.rooms.delete(event.room);
  }
}

async function setupListeners(nc: NatsConnection) {
  // Presence (legacy + lastSeen updates)
  const presenceSub = nc.subscribe(subjects.presence(project));
  (async () => {
    for await (const msg of presenceSub) {
      try {
        const payload = decode(msg.data) as { agent: string; status: string };
        if (payload.status === "offline") {
          agentPresence.delete(payload.agent);
        } else {
          const existing = agentPresence.get(payload.agent);
          if (existing) {
            existing.lastSeen = Date.now();
          } else {
            agentPresence.set(payload.agent, {
              agentId: payload.agent,
              displayName: payload.agent,
              rooms: new Set(),
              joinedAt: Date.now(),
              lastSeen: Date.now(),
            });
          }
        }
      } catch {}
    }
  })();

  // Registry (identity events)
  const registrySub = nc.subscribe(subjects.registry(project));
  (async () => {
    for await (const msg of registrySub) {
      try {
        const event = decode(msg.data) as RegistryEvent;
        applyRegistryEvent(event);
      } catch {}
    }
  })();

  // Own DM inbox
  const dmSub = nc.subscribe(subjects.dm(project, agentId));
  // Also listen on legacy "claude-code" for backward compat
  const legacyDmSub = nc.subscribe(subjects.dm(project, "claude-code"));
  for (const sub of [dmSub, legacyDmSub]) {
    (async () => {
      for await (const msg of sub) {
        try {
          const payload = decode(msg.data) as { from: string; content: string };
          inbox.push({ from: payload.from, content: payload.content, timestamp: Date.now() });
        } catch {}
      }
    })();
  }
}

async function subscribeToRoom(room: string) {
  if (activeSubscriptions.has(room)) return;
  activeSubscriptions.add(room);
  const roomSub = nc.subscribe(subjects.room(project, room));
  (async () => {
    for await (const msg of roomSub) {
      try {
        const payload = decode(msg.data) as { from: string; content: string };
        inbox.push({ from: payload.from, content: payload.content, timestamp: Date.now() });
      } catch {}
    }
  })();
  publishRegistry({ type: "room-join", room });
}

// ---- MCP Server ----

const server = new McpServer({ name: "bridge-harness", version: "0.1.0" });

server.registerTool(
  "whoami",
  {
    description: "Get Claude Code's identity in the bridge",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        agentId,
        displayName,
        project,
        rooms: [...activeSubscriptions],
      }, null, 2),
    }],
  })
);

server.registerTool(
  "who_is_in",
  {
    description: "List agents connected to a specific room",
    inputSchema: z.object({ room: z.string() }),
  },
  async ({ room }) => {
    const now = Date.now();
    const inRoom = [...agentPresence.values()].filter(
      (a) => now - a.lastSeen < PRESENCE_TTL_MS && a.rooms.has(room)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(inRoom.map(a => ({
        agentId: a.agentId,
        displayName: a.displayName,
        lastSeen: a.lastSeen,
      })), null, 2) }],
    };
  }
);

server.registerTool(
  "join_room",
  {
    description: "Join a room to receive its messages",
    inputSchema: z.object({ room: z.string() }),
  },
  async ({ room }) => {
    await subscribeToRoom(room);
    return { content: [{ type: "text", text: `Joined room: ${room}` }] };
  }
);

server.registerTool(
  "send",
  {
    description: "Send a message to a room or agent",
    inputSchema: z.object({
      to: z.string().describe('e.g. "room:venflowapp" or "agent:pi-a3f7"'),
      message: z.string(),
    }),
  },
  async ({ to, message }) => {
    const [type, target] = to.split(":");
    const subject = type === "room"
      ? subjects.room(project, target)
      : subjects.dm(project, target);
    nc.publish(subject, encode({ from: agentId, content: message, timestamp: Date.now() }));
    return { content: [{ type: "text", text: `Sent to ${to}` }] };
  }
);

server.registerTool(
  "read",
  {
    description: "Read pending messages from the inbox",
    inputSchema: z.object({}),
  },
  async () => {
    const messages = inbox.splice(0);
    return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
  }
);

server.registerTool(
  "list_agents",
  {
    description: "List active agents (seen in the last 60s)",
    inputSchema: z.object({}),
  },
  async () => {
    const now = Date.now();
    const active = [...agentPresence.values()]
      .filter((a) => now - a.lastSeen < PRESENCE_TTL_MS)
      .map((a) => ({
        agentId: a.agentId,
        displayName: a.displayName,
        rooms: [...a.rooms],
        lastSeen: a.lastSeen,
      }));
    return { content: [{ type: "text", text: JSON.stringify(active, null, 2) }] };
  }
);

async function main() {
  await ensureNats();
  nc = await connect({ servers: NATS_URL });

  await setupListeners(nc);

  // Write state file so the rewake hook knows what subject to use
  writeStateFile(project, agentId);

  // Announce presence + identity
  nc.publish(subjects.presence(project), encode({ agent: agentId, status: "active" }));
  publishRegistry({ type: "join" });

  // Heartbeat
  setInterval(() => {
    nc.publish(subjects.presence(project), encode({ agent: agentId, status: "active" }));
  }, 30_000);

  function cleanup() {
    publishRegistry({ type: "leave" });
    deleteStateFile();
    nc.drain().catch(() => {});
  }
  process.on("exit", cleanup);
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => { console.error(err); process.exit(1); });
