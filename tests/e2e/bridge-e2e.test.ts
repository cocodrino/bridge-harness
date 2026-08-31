import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, type NatsConnection } from "nats";
import { resolve } from "node:path";
import { createConnection } from "node:net";

/**
 * End-to-end: drives the REAL built MCP server over its stdio transport while a second
 * NATS client plays the part of a peer agent (a Pi extension, another Claude session).
 *
 * Everything here is a regression guard for a failure the unit tests cannot see: the
 * bridge reported success at every layer while messages silently went nowhere.
 *
 * Requires a running nats-server. Skipped when none is listening, so `npm test` stays
 * green on a machine without one.
 */

const MCP_PATH = resolve(__dirname, "../../dist/mcp-server/index.js");
const PROJECT = "bridge-e2e";
const SELF_ID = "e2e-claude";
const PEER_ID = "e2e-peer";

function portOpen(port: number): Promise<boolean> {
  return new Promise((r) => {
    const s = createConnection({ port, host: "localhost" });
    s.once("connect", () => { s.destroy(); r(true); });
    s.once("error", () => r(false));
  });
}

const natsUp = await portOpen(4222);

/** Minimal JSON-RPC client for the MCP server's newline-delimited stdio transport. */
class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (v: unknown) => void>();
  private buffer = "";
  stderr = "";

  constructor(env: Record<string, string>) {
    this.proc = spawn("node", [MCP_PATH], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown };
          if (typeof msg.id === "number" && this.pending.has(msg.id)) {
            this.pending.get(msg.id)!(msg.result);
            this.pending.delete(msg.id);
          }
        } catch { /* not a JSON-RPC frame */ }
      }
    });

    this.proc.stderr.on("data", (c: Buffer) => { this.stderr += c.toString(); });
  }

  private send(method: string, params: unknown, expectReply: boolean): Promise<unknown> {
    const id = this.nextId++;
    const frame = expectReply
      ? { jsonrpc: "2.0", id, method, params }
      : { jsonrpc: "2.0", method, params };
    const done = expectReply
      ? new Promise<unknown>((r) => this.pending.set(id, r))
      : Promise.resolve(undefined);
    this.proc.stdin.write(JSON.stringify(frame) + "\n");
    return done;
  }

  async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1.0.0" },
    }, true);
    await this.send("notifications/initialized", {}, false);
  }

  /** Calls a tool and parses the JSON text payload the bridge tools return. */
  async callJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = (await this.send("tools/call", { name, arguments: args }, true)) as {
      content?: Array<{ text?: string }>;
    };
    return JSON.parse(res.content?.[0]?.text ?? "null") as T;
  }

  async callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const res = (await this.send("tools/call", { name, arguments: args }, true)) as {
      content?: Array<{ text?: string }>;
    };
    return res.content?.[0]?.text ?? "";
  }

  kill() { this.proc.kill("SIGKILL"); }
}

interface WhoAmI {
  agentId: string;
  displayName: string;
  project: string;
  rooms: string[];
  canBeWokenByIncomingMessages?: boolean;
}

interface Agent {
  agentId: string;
  displayName: string;
  project?: string;
  rooms: string[];
}

interface InboxItem { from: string; content: string; timestamp: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until `check` passes, so tests don't depend on a fixed propagation delay. */
async function eventually<T>(get: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await get();
  while (Date.now() < deadline) {
    if (check(last)) return last;
    await sleep(250);
    last = await get();
  }
  return last;
}

describe.skipIf(!natsUp)("E2E: MCP server on a live bridge", () => {
  let mcp: McpClient;
  let peer: NatsConnection;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const peerInbox: InboxItem[] = [];

  beforeAll(async () => {
    mcp = new McpClient({
      BRIDGE_AGENT_ID: SELF_ID,
      BRIDGE_PROJECT: PROJECT,
      BRIDGE_DISPLAY_NAME: "E2E Claude",
    });
    await mcp.initialize();

    // The peer stands in for a Pi extension / another agent: it announces itself the same
    // way the real halves do, so the MCP server can discover it.
    peer = await connect({ servers: "nats://localhost:4222", maxReconnectAttempts: -1 });

    const registry = peer.subscribe("bridge.registry");
    (async () => {
      for await (const m of registry) {
        const ev = JSON.parse(dec.decode(m.data)) as { type: string; agentId: string };
        if (ev.agentId === PEER_ID) continue;
        if (ev.type === "who-there") {
          peer.publish("bridge.registry", enc.encode(JSON.stringify({
            type: "here", agentId: PEER_ID, displayName: "E2E Peer",
            project: PROJECT, rooms: [PROJECT], aliases: [], timestamp: Date.now(),
          })));
        }
      }
    })();

    const dm = peer.subscribe(`bridge.dm.${PEER_ID}`);
    (async () => {
      for await (const m of dm) peerInbox.push(JSON.parse(dec.decode(m.data)) as InboxItem);
    })();

    const room = peer.subscribe(`bridge.${PROJECT}.room.${PROJECT}`);
    (async () => {
      for await (const m of room) peerInbox.push(JSON.parse(dec.decode(m.data)) as InboxItem);
    })();

    peer.publish("bridge.presence", enc.encode(JSON.stringify({
      agent: PEER_ID, status: "active", project: PROJECT,
    })));
    peer.publish("bridge.registry", enc.encode(JSON.stringify({
      type: "join", agentId: PEER_ID, displayName: "E2E Peer",
      project: PROJECT, rooms: [PROJECT], aliases: [], timestamp: Date.now(),
    })));
    peer.publish("bridge.registry", enc.encode(JSON.stringify({
      type: "room-join", agentId: PEER_ID, displayName: "E2E Peer", room: PROJECT,
      project: PROJECT, aliases: [], timestamp: Date.now(),
    })));

    await sleep(1_500);
  }, 30_000);

  afterAll(async () => {
    mcp?.kill();
    await peer?.drain().catch(() => {});
  });

  it("reports its own identity and the room it joined", async () => {
    const me = await mcp.callJson<WhoAmI>("whoami");
    expect(me.agentId).toBe(SELF_ID);
    expect(me.project).toBe(PROJECT);
    expect(me.rooms).toContain(PROJECT);
  });

  it("tells you whether it can actually be woken by an incoming message", async () => {
    const me = await mcp.callJson<WhoAmI>("whoami");
    // The field must exist regardless of value: its absence is what let a bridge that
    // could receive but never wake look perfectly healthy.
    expect(me).toHaveProperty("canBeWokenByIncomingMessages");
    expect(typeof me.canBeWokenByIncomingMessages).toBe("boolean");
  });

  it("discovers the peer through registry discovery", async () => {
    const agents = await eventually(
      () => mcp.callJson<Agent[]>("list_agents"),
      (a) => a.some((x) => x.agentId === PEER_ID)
    );
    const found = agents.find((a) => a.agentId === PEER_ID);
    expect(found).toBeDefined();
    expect(found!.rooms).toContain(PROJECT);
  });

  // The regression this whole investigation started from: the agent used to appear in its
  // own roster with rooms: [], so list_agents contradicted whoami and the contradiction
  // was misread as a broken subscription.
  it("never lists itself as a peer", async () => {
    const agents = await eventually(
      () => mcp.callJson<Agent[]>("list_agents"),
      (a) => a.some((x) => x.agentId === PEER_ID)
    );
    expect(agents.map((a) => a.agentId)).not.toContain(SELF_ID);
  });

  it("list_agents and whoami agree about room membership", async () => {
    const me = await mcp.callJson<WhoAmI>("whoami");
    const agents = await mcp.callJson<Agent[]>("list_agents");
    const self = agents.find((a) => a.agentId === me.agentId);
    // Either we are absent (correct), or — if a future change re-adds a self entry — its
    // rooms must at least match reality rather than being empty.
    if (self) expect(self.rooms.sort()).toEqual(me.rooms.sort());
  });

  it("delivers a DM from the MCP server to the peer", async () => {
    peerInbox.length = 0;
    await mcp.callText("send", { to: `agent:${PEER_ID}`, message: "ping-dm" });
    await eventually(async () => peerInbox, (i) => i.some((m) => m.content === "ping-dm"));
    expect(peerInbox.map((m) => m.content)).toContain("ping-dm");
    expect(peerInbox.find((m) => m.content === "ping-dm")!.from).toBe(SELF_ID);
  });

  it("delivers a room message from the MCP server to the peer", async () => {
    peerInbox.length = 0;
    await mcp.callText("send", { to: `room:${PROJECT}`, message: "ping-room" });
    await eventually(async () => peerInbox, (i) => i.some((m) => m.content === "ping-room"));
    expect(peerInbox.map((m) => m.content)).toContain("ping-room");
  });

  it("receives a DM sent by the peer", async () => {
    peer.publish(`bridge.dm.${SELF_ID}`, enc.encode(JSON.stringify({
      from: PEER_ID, content: "pong-dm",
    })));
    const inbox = await eventually(
      () => mcp.callJson<InboxItem[]>("read"),
      (i) => i.some((m) => m.content === "pong-dm")
    );
    expect(inbox.map((m) => m.content)).toContain("pong-dm");
  });

  it("receives a room message sent by the peer", async () => {
    peer.publish(`bridge.${PROJECT}.room.${PROJECT}`, enc.encode(JSON.stringify({
      from: PEER_ID, content: "pong-room",
    })));
    const inbox = await eventually(
      () => mcp.callJson<InboxItem[]>("read"),
      (i) => i.some((m) => m.content === "pong-room")
    );
    expect(inbox.map((m) => m.content)).toContain("pong-room");
  });

  it("routes a DM to a set_name alias", async () => {
    await mcp.callText("set_name", { name: "e2e-alias" });
    peer.publish("bridge.dm.e2e-alias", enc.encode(JSON.stringify({
      from: PEER_ID, content: "via-alias",
    })));
    const inbox = await eventually(
      () => mcp.callJson<InboxItem[]>("read"),
      (i) => i.some((m) => m.content === "via-alias")
    );
    expect(inbox.map((m) => m.content)).toContain("via-alias");
  });
});
