#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, type NatsConnection, type Subscription } from "nats";
import { z } from "zod";
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


interface InboxMessage {
  from: string;
  content: string;
  timestamp: number;
}

const inbox: InboxMessage[] = [];
const agentPresence = new Map<string, AgentPresence>();
const activeSubscriptions = new Set<string>();
// Every NATS subscription we hold, so we can tear them down when switching bridges.
let trackedSubs: Subscription[] = [];
let nc: NatsConnection;

// Mutable so `use_bridge` can move us to another namespace at runtime.
let project = getProject();
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

  if (event.type === "who-there") {
    // Another agent is discovering peers — answer with our full identity.
    publishRegistry({ type: "here", rooms: [...activeSubscriptions] });
    return;
  }

  if (event.type === "here") {
    const existing = agentPresence.get(event.agentId);
    agentPresence.set(event.agentId, {
      agentId: event.agentId,
      displayName: event.displayName,
      rooms: new Set(event.rooms ?? []),
      joinedAt: existing?.joinedAt ?? event.timestamp,
      lastSeen: event.timestamp,
    });
    return;
  }

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
  trackedSubs.push(presenceSub);
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
  trackedSubs.push(registrySub);
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
  trackedSubs.push(dmSub, legacyDmSub);
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
  trackedSubs.push(roomSub);
  (async () => {
    for await (const msg of roomSub) {
      try {
        const payload = decode(msg.data) as { from: string; content: string };
        inbox.push({ from: payload.from, content: payload.content, timestamp: Date.now() });
      } catch {}
    }
  })();
  publishRegistry({ type: "room-join", room });
  // Refresh roster for this room: ask who else is around.
  publishRegistry({ type: "who-there" });
}

// Move to a different bridge namespace at runtime without restarting. Both agents
// must switch to the same bridge name to see each other. Idempotent if already there.
async function switchBridge(newProject: string): Promise<string> {
  const target = newProject.trim();
  if (!target) return `Bridge name cannot be empty (still on "${project}")`;
  if (target === project) return `Already on bridge "${project}"`;
  const oldProject = project;

  // Leave the current bridge cleanly.
  publishRegistry({ type: "leave" });
  nc.publish(subjects.presence(project), encode({ agent: agentId, status: "offline" }));

  // Tear down every subscription on the old namespace.
  for (const sub of trackedSubs) {
    try { sub.unsubscribe(); } catch {}
  }
  trackedSubs = [];

  // Reset per-bridge state — the new bridge starts with a clean roster and inbox.
  activeSubscriptions.clear();
  agentPresence.clear();
  inbox.length = 0;

  // Switch and re-wire on the new namespace (mirrors startup).
  project = target;
  await setupListeners(nc);
  nc.publish(subjects.presence(project), encode({ agent: agentId, status: "active" }));
  publishRegistry({ type: "join" });
  await subscribeToRoom(project);

  return `Switched to bridge "${target}" (from "${oldProject}"). Tell the other agent to use_bridge "${target}" too.`;
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
  "use_bridge",
  {
    description: "Switch to a different bridge namespace at runtime (no restart). Both agents must use the same bridge name to communicate, regardless of where each was launched.",
    inputSchema: z.object({ bridge: z.string().describe("The bridge/namespace name to join, e.g. \"debugging-session\"") }),
  },
  async ({ bridge }) => {
    const result = await switchBridge(bridge);
    return { content: [{ type: "text", text: result }] };
  }
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

  // Announce presence + identity
  nc.publish(subjects.presence(project), encode({ agent: agentId, status: "active" }));
  publishRegistry({ type: "join" });
  // Join the project room (shared lobby) by default — subscribes, announces presence,
  // and broadcasts who-there to discover agents that connected before us (registry
  // events aren't retained). Keeps Claude visible in the same default room as Pi.
  await subscribeToRoom(project);

  // Heartbeat
  setInterval(() => {
    nc.publish(subjects.presence(project), encode({ agent: agentId, status: "active" }));
  }, 30_000);

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    publishRegistry({ type: "leave" });
    nc.drain().catch(() => {});
  }
  process.on("exit", cleanup);
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  // Parent-death watchdog: if Claude Code exits without signaling us (crash or force
  // kill), this process is reparented to launchd/init (ppid becomes 1). Detect that
  // and exit cleanly so we don't linger as a zombie agent on the bridge.
  const initialPpid = process.ppid;
  if (initialPpid !== 1) {
    setInterval(() => {
      if (process.ppid === 1 || process.ppid !== initialPpid) {
        cleanup();
        process.exit(0);
      }
    }, 5000);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => { console.error(err); process.exit(1); });
