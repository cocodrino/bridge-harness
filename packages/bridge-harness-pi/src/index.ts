import { connect, type NatsConnection } from "nats";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const NATS_URL = "nats://localhost:4222";
const PRESENCE_INTERVAL_MS = 30_000;
const PRESENCE_TTL_MS = 60_000;

function getProject(): string {
  return process.env.BRIDGE_PROJECT ?? require("node:path").basename(process.cwd());
}

function subjects(project: string) {
  return {
    room: (room: string) => `bridge.${project}.room.${room}`,
    dm: (agentId: string) => `bridge.${project}.dm.${agentId}`,
    presence: () => `bridge.${project}.presence`,
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

export default function bridgeExtension(pi: ExtensionAPI) {
  const project = getProject();
  const sub = subjects(project);
  let nc: NatsConnection | null = null;
  let presenceInterval: ReturnType<typeof setInterval> | null = null;
  let isProcessingTurn = false;
  const messageQueue: string[] = [];

  function deliverMessage(content: string) {
    pi.sendMessage(
      { content, customType: "bridge-delivery", display: false },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }

  function flushQueue() {
    while (messageQueue.length > 0) {
      const msg = messageQueue.shift()!;
      deliverMessage(msg);
    }
  }

  async function subscribeToIncoming(nc: NatsConnection) {
    const dmSub = nc.subscribe(sub.dm("pi"));
    const roomSub = nc.subscribe(sub.roomWildcard());

    for (const subscription of [dmSub, roomSub]) {
      (async () => {
        for await (const msg of subscription) {
          try {
            const payload = decode(msg.data) as {
              from: string;
              content: string;
            };
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
  }

  pi.on("session_start", async () => {
    try {
      nc = await connect({ servers: NATS_URL });
      const presenceSub = sub.presence();

      nc.publish(presenceSub, encode({ agent: "pi", status: "active" }));

      presenceInterval = setInterval(() => {
        nc?.publish(presenceSub, encode({ agent: "pi", status: "active" }));
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
      nc.publish(sub.presence(), encode({ agent: "pi", status: "offline" }));
      await nc.drain();
      nc = null;
    }
  });

  pi.registerTool({
    name: "agent_bridge",
    label: "Agent Bridge",
    description: "Send messages to other agents via NATS bridge",
    parameters: Type.Object({
      action: Type.String({ enum: ["send", "list_agents"], description: "Action to perform" }),
      to: Type.Optional(Type.String({ description: 'Target, e.g. "room:venflowapp" or "agent:claude-code"' })),
      message: Type.Optional(Type.String({ description: "Message content" })),
    }),
    async execute(_toolCallId, args, _signal, _onUpdate, _ctx) {
      const { action, to, message } = args as {
        action: string;
        to?: string;
        message?: string;
      };

      if (!nc) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Not connected to NATS" }) }],
          details: { error: "Not connected to NATS" },
        };
      }

      if (action === "send" && to && message) {
        const [type, target] = to.split(":");
        const subject = type === "room" ? sub.room(target) : sub.dm(target);
        nc.publish(
          subject,
          encode({ from: "pi", content: message, timestamp: Date.now() })
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, sent: to }) }],
          details: { ok: true, sent: to },
        };
      }

      if (action === "list_agents") {
        return {
          content: [{ type: "text", text: JSON.stringify({ info: "Use bridge agents CLI for presence info" }) }],
          details: { info: "Use bridge agents CLI for presence info" },
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown action: ${action}` }) }],
        details: { error: `Unknown action: ${action}` },
      };
    },
  });
}
