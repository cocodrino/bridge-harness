#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, type NatsConnection, type Subscription } from "nats";
import { z } from "zod";
import { getProject, NATS_URL, PRESENCE_TTL_MS } from "../shared/config.js";
import { subjects } from "../shared/subjects.js";
import { ensureNats } from "../nats-manager/index.js";

interface InboxMessage {
  from: string;
  content: string;
  timestamp: number;
}

interface AgentPresence {
  agentId: string;
  lastSeen: number;
}

const inbox: InboxMessage[] = [];
const agentPresence = new Map<string, AgentPresence>();
const activeSubscriptions = new Set<string>();
let nc: NatsConnection;
const project = getProject();
const codec = new TextEncoder();
const decoder = new TextDecoder();

function encode(data: unknown): Uint8Array {
  return codec.encode(JSON.stringify(data));
}

function decode(data: Uint8Array): unknown {
  return JSON.parse(decoder.decode(data));
}

async function setupPresenceListener(nc: NatsConnection) {
  const sub = nc.subscribe(subjects.presence(project));
  (async () => {
    for await (const msg of sub) {
      try {
        const payload = decode(msg.data) as {
          agent: string;
          status: string;
        };
        if (payload.status === "offline") {
          agentPresence.delete(payload.agent);
        } else {
          agentPresence.set(payload.agent, {
            agentId: payload.agent,
            lastSeen: Date.now(),
          });
        }
      } catch {}
    }
  })();
}

async function subscribeToRoom(room: string, sub?: Subscription) {
  const roomSub = sub ?? nc.subscribe(subjects.room(project, room));
  activeSubscriptions.add(room);
  (async () => {
    for await (const msg of roomSub) {
      try {
        const payload = decode(msg.data) as {
          from: string;
          content: string;
        };
        inbox.push({
          from: payload.from,
          content: payload.content,
          timestamp: Date.now(),
        });
      } catch {}
    }
  })();
}

const server = new McpServer({
  name: "bridge-harness",
  version: "0.1.0",
});

server.registerTool(
  "join_room",
  {
    description: "Join a room to receive its messages",
    inputSchema: z.object({ room: z.string() }),
  },
  async ({ room }) => {
    if (activeSubscriptions.has(room)) {
      return { content: [{ type: "text", text: `Already in room: ${room}` }] };
    }
    await subscribeToRoom(room);
    return { content: [{ type: "text", text: `Joined room: ${room}` }] };
  }
);

server.registerTool(
  "send",
  {
    description: "Send a message to a room or agent",
    inputSchema: z.object({
      to: z.string().describe('e.g. "room:venflowapp" or "agent:pi"'),
      message: z.string(),
    }),
  },
  async ({ to, message }) => {
    const [type, target] = to.split(":");
    const subject =
      type === "room"
        ? subjects.room(project, target)
        : subjects.dm(project, target);

    nc.publish(
      subject,
      encode({ from: "claude-code", content: message, timestamp: Date.now() })
    );
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
    return {
      content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
    };
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
    const active = [...agentPresence.values()].filter(
      (a) => now - a.lastSeen < PRESENCE_TTL_MS
    );
    return {
      content: [{ type: "text", text: JSON.stringify(active, null, 2) }],
    };
  }
);

async function main() {
  await ensureNats();
  nc = await connect({ servers: NATS_URL });

  // Subscribe to own DM inbox
  const dmSub = nc.subscribe(subjects.dm(project, "claude-code"));
  (async () => {
    for await (const msg of dmSub) {
      try {
        const payload = decode(msg.data) as {
          from: string;
          content: string;
        };
        inbox.push({
          from: payload.from,
          content: payload.content,
          timestamp: Date.now(),
        });
      } catch {}
    }
  })();

  await setupPresenceListener(nc);

  // Announce presence
  nc.publish(
    subjects.presence(project),
    encode({ agent: "claude-code", status: "active" })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
