import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NatsConnection } from "nats";

// Pi loads this extension through a symlink with preserve-symlinks enabled, so a
// plain `import ... from "nats"` resolves from the symlink's directory — where the
// dependency isn't reachable. Resolve nats from this file's REAL path instead, which
// lands in the package's actual node_modules. Falls back progressively if the host
// runtime exposes import.meta / require differently.
function loadNats(): typeof import("nats") {
  try {
    return createRequire(realpathSync(fileURLToPath(import.meta.url)))("nats");
  } catch {
    try {
      return createRequire(import.meta.url)("nats");
    } catch {
      return require("nats");
    }
  }
}

const { connect } = loadNats();

const NATS_URL = process.env.BRIDGE_NATS_URL ?? "nats://localhost:4222";
const PRESENCE_INTERVAL_MS = 30_000;

function getProject(): string {
  if (process.env.BRIDGE_PROJECT) return process.env.BRIDGE_PROJECT;
  const { basename } = require("node:path");
  // Use the git worktree root so each worktree gets its own isolated namespace,
  // stable regardless of which subdirectory the agent launches from.
  try {
    const { execFileSync } = require("node:child_process");
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return basename(top);
  } catch {
    // not a git repo, or git unavailable — fall back to the cwd name
  }
  return basename(process.cwd());
}

function generateAgentId(base: string): string {
  if (process.env.BRIDGE_AGENT_ID) return process.env.BRIDGE_AGENT_ID;
  return `${base}-${process.pid}`;
}

// When running under cmux, label the agent with the current surface name so multiple
// Pi instances are distinguishable on the bridge. BRIDGE_DISPLAY_NAME always wins.
function getCmuxSurfaceName(): string | null {
  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (!surfaceId) return null;
  const bin = process.env.CMUX_BUNDLED_CLI_PATH ?? "cmux";
  try {
    const { execFileSync } = require("node:child_process");
    const out: string = execFileSync(bin, ["tree", "--all", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    let raw: string | null = null;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.here === true && typeof n.title === "string") raw = n.title as string;
      for (const key of Object.keys(n)) {
        const v = n[key];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(JSON.parse(out));
    // Custom name only if it's a short slug, not a dynamic agent task title.
    if (raw) {
      const startsWithGlyph = /^[^\p{L}\p{N}]/u.test(raw);
      const clean = (raw as string).replace(/\s+/g, " ").trim();
      if (!startsWithGlyph && clean.length > 0 && clean.length <= 24 && clean.split(" ").length <= 2) {
        return clean;
      }
    }
  } catch {
    // cmux CLI unavailable — fall through to the id-based label
  }
  return `cmux:${surfaceId.slice(0, 8).toLowerCase()}`;
}

function getDisplayName(fallback: string): string {
  if (process.env.BRIDGE_DISPLAY_NAME) return process.env.BRIDGE_DISPLAY_NAME;
  const surface = getCmuxSurfaceName();
  return surface ? `${fallback} @ ${surface}` : fallback;
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

interface InboxMessage {
  from: string;
  content: string;
  timestamp: number;
}

export default function bridgeExtension(pi: ExtensionAPI) {
  const project = getProject();
  const agentId = generateAgentId("pi");
  const displayName = getDisplayName("Pi Agent");
  const sub = makeSubjects(project);

  let nc: NatsConnection | null = null;
  let presenceInterval: ReturnType<typeof setInterval> | null = null;
  let isProcessingTurn = false;
  // Pending messages that arrived mid-turn. Drained by `read` or flushed on agent_end.
  const inbox: InboxMessage[] = [];
  const roster = new Map<string, AgentInfo>();
  // Pi receives every room via the wildcard subscription (for delivery), but for
  // *presence* it joins the project room by default — the shared lobby other agents
  // can find it in. Explicit join_room calls add more rooms here.
  const joinedRooms = new Set<string>([project]);

  function publishRegistry(
    type: "join" | "leave" | "room-join" | "room-leave" | "who-there",
    room?: string,
  ) {
    if (!nc) return;
    nc.publish(sub.registry(), encode({ type, agentId, displayName, room, timestamp: Date.now() }));
  }

  // Identity response to a who-there query, carrying every room we're in.
  function publishHere() {
    if (!nc) return;
    nc.publish(
      sub.registry(),
      encode({ type: "here", agentId, displayName, rooms: [...joinedRooms], timestamp: Date.now() }),
    );
  }

  function applyRegistryEvent(event: {
    type: string; agentId: string; displayName: string; room?: string; rooms?: string[];
  }) {
    if (event.agentId === agentId) return;
    if (event.type === "who-there") {
      // A peer is discovering — answer with our identity.
      publishHere();
      return;
    }
    if (event.type === "here") {
      roster.set(event.agentId, {
        agentId: event.agentId,
        displayName: event.displayName,
        rooms: new Set(event.rooms ?? []),
      });
      return;
    }
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
    // We're about to trigger (or steer into) a turn, so mark it active. This makes
    // subsequent incoming messages buffer instead of interrupting. Reset on agent_end.
    isProcessingTurn = true;
    pi.sendMessage(
      { content, customType: "bridge-delivery", display: false },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }

  function formatMessage(msg: InboxMessage): string {
    return `[Bridge] Message from ${msg.from}: ${msg.content}`;
  }

  // Deliver every buffered message as a single steer, emptying the inbox.
  function flushInbox() {
    if (inbox.length === 0) return;
    const batch = inbox.splice(0);
    deliverMessage(batch.map(formatMessage).join("\n"));
  }

  function handleIncoming(payload: { from: string; content: string }) {
    const msg: InboxMessage = { from: payload.from, content: payload.content, timestamp: Date.now() };
    inbox.push(msg);
    // Idle → wake the agent immediately (preserves push behavior). Mid-turn → leave
    // it buffered so we don't interrupt; the agent pulls it via `read` or gets it
    // flushed on agent_end.
    if (!isProcessingTurn) flushInbox();
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
            handleIncoming(decode(msg.data) as { from: string; content: string });
          } catch {}
        }
      })();
    }

    (async () => {
      for await (const msg of registrySub) {
        try {
          applyRegistryEvent(decode(msg.data) as { type: string; agentId: string; displayName: string; room?: string; rooms?: string[] });
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
      // Join the project room (shared lobby) by default for presence.
      publishRegistry("room-join", project);

      presenceInterval = setInterval(() => {
        nc?.publish(sub.presence(), encode({ agent: agentId, status: "active" }));
      }, PRESENCE_INTERVAL_MS);

      await subscribeToIncoming(nc);

      // Discover agents that connected before us (registry events aren't retained).
      // Must run AFTER subscribing so we receive the `here` responses.
      publishRegistry("who-there");
    } catch (err) {
      console.error("[bridge-harness-pi] Failed to connect to NATS:", err);
    }
  });

  pi.on("agent_end", () => {
    isProcessingTurn = false;
    // Safety net: deliver anything the agent didn't pull via `read` during its turn.
    flushInbox();
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
    description: "Communicate with other agents via the NATS bridge",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["send", "list_agents", "whoami", "join_room", "read"],
          description: "Action to perform",
        },
        to: { type: "string", description: 'Target for send: "room:venflowapp" or "agent:claude-code-9x2k"' },
        message: { type: "string", description: "Message content for send" },
        room: { type: "string", description: "Room name for join_room" },
      },
      required: ["action"],
    } as any,
    async execute(_toolCallId, args, _signal, _onUpdate, _ctx) {
      const { action, to, message, room } = args as {
        action: string; to?: string; message?: string; room?: string;
      };

      // The agent is calling a tool, so a turn is active: buffer incoming messages.
      isProcessingTurn = true;

      if (action === "whoami") {
        const identity = { agentId, displayName, project, rooms: [...joinedRooms] };
        return {
          content: [{ type: "text", text: JSON.stringify(identity, null, 2) }],
          details: identity,
        };
      }

      if (action === "read") {
        const messages = inbox.splice(0);
        return {
          content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
          details: { messages },
        };
      }

      if (!nc) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Not connected to NATS" }) }],
          details: { error: "Not connected to NATS" },
        };
      }

      if (action === "join_room" && room) {
        // Pi already receives every room via the wildcard subscription. join_room only
        // announces presence so other agents see us in this room (who_is_in / list_agents).
        joinedRooms.add(room);
        publishRegistry("room-join", room);
        // Refresh roster: ask who else is around.
        publishRegistry("who-there");
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, joined: room }) }],
          details: { ok: true, joined: room },
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
