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

function publishRegistry(event: Omit<RegistryEvent, "agentId" | "displayName" | "project" | "timestamp">) {
  nc.publish(
    subjects.registry(),
    encode({ ...event, agentId, displayName, project, timestamp: Date.now() } satisfies RegistryEvent)
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
      project: event.project,
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
      project: event.project,
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
  // Presence (global — legacy + lastSeen updates)
  const presenceSub = nc.subscribe(subjects.presence());
  trackedSubs.push(presenceSub);
  (async () => {
    for await (const msg of presenceSub) {
      try {
        const payload = decode(msg.data) as { agent: string; status: string; project?: string };
        if (payload.status === "offline") {
          agentPresence.delete(payload.agent);
        } else {
          const existing = agentPresence.get(payload.agent);
          if (existing) {
            existing.lastSeen = Date.now();
            if (payload.project) existing.project = payload.project;
          } else {
            agentPresence.set(payload.agent, {
              agentId: payload.agent,
              displayName: payload.agent,
              project: payload.project,
              rooms: new Set(),
              joinedAt: Date.now(),
              lastSeen: Date.now(),
            });
          }
        }
      } catch {}
    }
  })();

  // Registry (global — identity events)
  const registrySub = nc.subscribe(subjects.registry());
  trackedSubs.push(registrySub);
  (async () => {
    for await (const msg of registrySub) {
      try {
        const event = decode(msg.data) as RegistryEvent;
        applyRegistryEvent(event);
      } catch {}
    }
  })();

  // Own DM inbox (global — reachable by agentId across any project/worktree)
  const dmSub = nc.subscribe(subjects.dm(agentId));
  // Also listen on legacy "claude-code" for backward compat
  const legacyDmSub = nc.subscribe(subjects.dm("claude-code"));
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

// Move to a different project's ROOM space at runtime without restarting. DMs and
// discovery are global, so this only changes which project's rooms/lobby you're in
// (useful to share an isolated room with agents in another worktree). Idempotent.
async function switchBridge(newProject: string): Promise<string> {
  const target = newProject.trim();
  if (!target) return `Bridge name cannot be empty (still on "${project}")`;
  if (target === project) return `Already on bridge "${project}"`;
  const oldProject = project;

  // Leave the current project's rooms cleanly.
  publishRegistry({ type: "leave" });

  // Tear down subscriptions. Global subs (dm/registry/presence) get re-created with
  // identical subjects; only the room subscriptions actually change.
  for (const sub of trackedSubs) {
    try { sub.unsubscribe(); } catch {}
  }
  trackedSubs = [];
  activeSubscriptions.clear();
  // Roster and inbox are NOT cleared — they're global and stay valid across the switch.

  // Switch project and re-wire (mirrors startup): global listeners + new project lobby.
  project = target;
  await setupListeners(nc);
  nc.publish(subjects.presence(), encode({ agent: agentId, status: "active", project }));
  publishRegistry({ type: "join" });
  await subscribeToRoom(project);

  return `Switched to project "${target}" (from "${oldProject}") for rooms. Note: DMs already reach any agent by ID across projects — use_bridge is only needed to share a room.`;
}

// ---- MCP Server ----

const server = new McpServer({ name: "bridge-harness", version: "0.1.0" });

server.registerTool(
  "whoami",
  {
    description:
      "Get your own identity on the bridge: agentId (how others DM you), displayName, " +
      "project (your git worktree — scopes your rooms only), and the rooms you're in. " +
      "Other agents can DM you by your agentId from any project.",
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
    description:
      "Join another project's ROOM space at runtime (no restart). You usually DON'T need " +
      "this: DMs and list_agents already work across projects/worktrees by identity. Use " +
      "it only to share an isolated room with agents in a different project — both agents " +
      "call use_bridge with the same name to land in the same room space.",
    inputSchema: z.object({ bridge: z.string().describe("The project/room-space name to join, e.g. the other agent's project") }),
  },
  async ({ bridge }) => {
    const result = await switchBridge(bridge);
    return { content: [{ type: "text", text: result }] };
  }
);

server.registerTool(
  "who_is_in",
  {
    description:
      "List agents present in a specific room. Rooms are scoped to YOUR project, so this " +
      "reflects your project's room only. To reach an agent in another project, DM it by " +
      "agentId (list_agents shows everyone) instead of relying on a shared room.",
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
        project: a.project,
        lastSeen: a.lastSeen,
      })), null, 2) }],
    };
  }
);

server.registerTool(
  "join_room",
  {
    description:
      "Join a room in YOUR project to receive its messages. Rooms are project-scoped, so " +
      "joining only connects you with agents in the same project — it does NOT bridge to " +
      "another worktree. To reach an agent elsewhere, DM it by agentId (see list_agents). " +
      "You auto-join your project's default lobby on connect, so you rarely need this.",
    inputSchema: z.object({ room: z.string().describe("Room name within your own project") }),
  },
  async ({ room }) => {
    await subscribeToRoom(room);
    return { content: [{ type: "text", text: `Joined room "${room}" in project "${project}". (Rooms are project-scoped; DM by agentId to reach other projects.)` }] };
  }
);

server.registerTool(
  "send",
  {
    description:
      "Send a message to an agent or a room. DMs (agent:<id>) are GLOBAL — they reach " +
      "the recipient by identity across any project/worktree, so prefer a DM to reach a " +
      "specific agent. Rooms (room:<name>) are scoped to YOUR project, so a room only " +
      "reaches agents in the same project. Use list_agents to get exact agent IDs.",
    inputSchema: z.object({
      to: z.string().describe('"agent:pi-a3f7" (global DM, preferred) or "room:venflowapp" (your project only)'),
      message: z.string(),
    }),
  },
  async ({ to, message }) => {
    const [type, target] = to.split(":");
    const subject = type === "room"
      ? subjects.room(project, target)
      : subjects.dm(target);
    nc.publish(subject, encode({ from: agentId, content: message, timestamp: Date.now() }));
    // NATS core publish always "succeeds" even with zero subscribers, so warn when we
    // can't see the recipient — the message may silently go nowhere.
    let note = `Sent to ${to}`;
    if (type === "agent") {
      const now = Date.now();
      const seen = agentPresence.get(target);
      if (!seen || now - seen.lastSeen >= PRESENCE_TTL_MS) {
        note += ` — ⚠️ warning: "${target}" is not visible on the bridge right now. ` +
          `Double-check the agent ID with list_agents; if it's wrong or the agent is offline, ` +
          `the message was dropped (no persistence).`;
      }
    }
    return { content: [{ type: "text", text: note }] };
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
    description:
      "List active agents on the bridge (seen in the last 60s), across ALL projects/worktrees. " +
      "Each entry includes its `project` so you know where it is; you can DM any of them by " +
      "`agent:<agentId>` regardless of project.",
    inputSchema: z.object({}),
  },
  async () => {
    const now = Date.now();
    const active = [...agentPresence.values()]
      .filter((a) => now - a.lastSeen < PRESENCE_TTL_MS)
      .map((a) => ({
        agentId: a.agentId,
        displayName: a.displayName,
        project: a.project,
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
  nc.publish(subjects.presence(), encode({ agent: agentId, status: "active", project }));
  publishRegistry({ type: "join" });
  // Join the project room (shared lobby) by default — subscribes, announces presence,
  // and broadcasts who-there to discover agents that connected before us (registry
  // events aren't retained). Keeps Claude visible in the same default room as Pi.
  await subscribeToRoom(project);

  // Heartbeat
  setInterval(() => {
    nc.publish(subjects.presence(), encode({ agent: agentId, status: "active", project }));
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
