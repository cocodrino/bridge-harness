import { connect, type NatsConnection } from "nats";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const PRESENCE_INTERVAL_MS = 30_000;

function getProject(): string {
  const { basename } = require("node:path");
  return process.env.BRIDGE_PROJECT ?? basename(process.cwd());
}

function generateAgentId(base: string): string {
  if (process.env.BRIDGE_AGENT_ID) return process.env.BRIDGE_AGENT_ID;
  return `${base}-${process.pid}`;
}

function getDisplayName(fallback: string): string {
  return process.env.BRIDGE_DISPLAY_NAME ?? fallback;
}

function makeSubjects(project: string) {
  return {
    room: (room: string) => `bridge.${project}.room.${room}`,
    dm: (agentId: string) => `bridge.${project}.dm.${agentId}`,
    presence: () => `bridge.${project}.presence`,
    registry: () => `bridge.${project}.registry`,
    roomWildcard: () => `bridge.${project}.room.*`,
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(data: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(data));
}

function decode(data: Uint8Array): unknown {
  return JSON.parse(decoder.decode(data));
}

interface AgentInfo {
  agentId: string;
  displayName: string;
  rooms: Set<string>;
}

export default function bridgeExtension(pi: ExtensionAPI) {
  const project = getProject();
  const agentId = generateAgentId("pi");
  const displayName = getDisplayName("Pi Agent");
  const sub = makeSubjects(project);

  let nc: NatsConnection | null = null;
  let presenceInterval: ReturnType<typeof setInterval> | null = null;
  let isProcessingTurn = false;
  const messageQueue: string[] = [];
  const roster = new Map<string, AgentInfo>();

  function publishRegistry(type: "join" | "leave" | "room-join" | "room-leave", room?: string) {
    if (!nc) return;
    nc.publish(sub.registry(), encode({ type, agentId, displayName, room, timestamp: Date.now() }));
  }

  function applyRegistryEvent(event: {
    type: string; agentId: string; displayName: string; room?: string;
  }) {
    if (event.agentId === agentId) return;
    if (event.type === "join") {
      roster.set(event.agentId, { agentId: event.agentId, displayName: event.displayName, rooms: new Set() });
    } else if (event.type === "leave") {
      roster.delete(event.agentId);
    } else if (event.type === "room-join" && event.room) {
      roster.get(event.agentId)?.rooms.add(event.room);
    } else if (event.type === "room-leave" && event.room) {
      roster.get(event.agentId)?.rooms.delete(event.room);
    }
  }

  function deliverMessage(content: string) {
    pi.sendMessage(
      { content, customType: "bridge-delivery", display: false },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }

  function flushQueue() {
    while (messageQueue.length > 0) {
      deliverMessage(messageQueue.shift()!);
    }
  }

  async function subscribeToIncoming(nc: NatsConnection) {
    const dmSub = nc.subscribe(sub.dm(agentId));
    // Always subscribe to canonical "pi" so agents can reach us without knowing the dynamic ID
    const canonicalDmSub = nc.subscribe(sub.dm("pi"));
    const roomSub = nc.subscribe(sub.roomWildcard());
    const registrySub = nc.subscribe(sub.registry());

    for (const subscription of [dmSub, canonicalDmSub, roomSub]) {
      (async () => {
        for await (const msg of subscription) {
          try {
            const payload = decode(msg.data) as { from: string; content: string };
            const formatted = `[Bridge] Message from ${payload.from}: ${payload.content}`;
            if (isProcessingTurn) {
              messageQueue.push(formatted);
            } else {
              deliverMessage(formatted);
            }
          } catch {}
        }
      })();
    }

    (async () => {
      for await (const msg of registrySub) {
        try {
          applyRegistryEvent(decode(msg.data) as { type: string; agentId: string; displayName: string; room?: string });
        } catch {}
      }
    })();
  }

  pi.on("session_start", async () => {
    try {
      nc = await connect({ servers: NATS_URL });

      // Register identity
      nc.publish(sub.presence(), encode({ agent: agentId, status: "active" }));
      publishRegistry("join");
      publishRegistry("room-join", "*");

      presenceInterval = setInterval(() => {
        nc?.publish(sub.presence(), encode({ agent: agentId, status: "active" }));
      }, PRESENCE_INTERVAL_MS);

      await subscribeToIncoming(nc);
    } catch (err) {
      console.error("[bridge-harness-pi] Failed to connect to NATS:", err);
    }
  });

  pi.on("agent_end", () => {
    isProcessingTurn = false;
    flushQueue();
  });

  pi.on("session_shutdown", async () => {
    if (presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = null;
    }
    if (nc) {
      publishRegistry("leave");
      nc.publish(sub.presence(), encode({ agent: agentId, status: "offline" }));
      await nc.drain();
      nc = null;
    }
  });

  pi.registerTool({
    name: "agent_bridge",
    label: "Agent Bridge",
    description: "Send messages to other agents via NATS bridge",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "list_agents"], description: "Action to perform" },
        to: { type: "string", description: 'Target: "room:venflowapp" or "agent:claude-code-9x2k"' },
        message: { type: "string", description: "Message content" },
      },
      required: ["action"],
    } as any,
    async execute(_toolCallId, args, _signal, _onUpdate, _ctx) {
      const { action, to, message } = args as { action: string; to?: string; message?: string };

      if (!nc) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Not connected to NATS" }) }],
          details: { error: "Not connected to NATS" },
        };
      }

      if (action === "send" && to && message) {
        const [type, target] = to.split(":");
        const subject = type === "room" ? sub.room(target) : sub.dm(target);
        nc.publish(subject, encode({ from: agentId, content: message, timestamp: Date.now() }));
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, sent: to, from: agentId }) }],
          details: { ok: true, sent: to, from: agentId },
        };
      }

      if (action === "list_agents") {
        const agents = [...roster.values()].map(a => ({
          agentId: a.agentId,
          displayName: a.displayName,
          rooms: [...a.rooms],
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
          details: { agents },
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown action: ${action}` }) }],
        details: { error: `Unknown action: ${action}` },
      };
    },
  });
}
