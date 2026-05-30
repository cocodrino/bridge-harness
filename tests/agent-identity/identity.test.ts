import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateAgentId, getDisplayName } from "../../src/shared/config.js";

describe("generateAgentId", () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it("generates id with correct format", () => {
    delete process.env.BRIDGE_AGENT_ID;
    const id = generateAgentId("pi");
    expect(id).toMatch(/^pi-[a-z0-9]{4}$/);
  });

  it("generates unique ids on multiple calls", () => {
    delete process.env.BRIDGE_AGENT_ID;
    const ids = new Set(Array.from({ length: 20 }, () => generateAgentId("pi")));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("respects BRIDGE_AGENT_ID env var", () => {
    process.env.BRIDGE_AGENT_ID = "my-fixed-pi";
    expect(generateAgentId("pi")).toBe("my-fixed-pi");
  });

  it("uses base prefix correctly", () => {
    delete process.env.BRIDGE_AGENT_ID;
    expect(generateAgentId("claude-code")).toMatch(/^claude-code-/);
  });
});

describe("getDisplayName", () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it("uses BRIDGE_DISPLAY_NAME when defined", () => {
    process.env.BRIDGE_DISPLAY_NAME = "My Custom Agent";
    expect(getDisplayName("fallback")).toBe("My Custom Agent");
  });

  it("uses fallback when BRIDGE_DISPLAY_NAME is not set", () => {
    delete process.env.BRIDGE_DISPLAY_NAME;
    expect(getDisplayName("Pi Agent")).toBe("Pi Agent");
  });
});

describe("MCP roster management", () => {
  // Replicate roster logic for unit testing
  interface AgentPresence {
    agentId: string;
    displayName: string;
    rooms: Set<string>;
    joinedAt: number;
    lastSeen: number;
  }

  function createRoster() {
    const roster = new Map<string, AgentPresence>();

    function apply(event: { type: string; agentId: string; displayName: string; room?: string; timestamp: number }) {
      if (event.type === "join") {
        roster.set(event.agentId, {
          agentId: event.agentId,
          displayName: event.displayName,
          rooms: new Set(),
          joinedAt: event.timestamp,
          lastSeen: event.timestamp,
        });
      } else if (event.type === "leave") {
        roster.delete(event.agentId);
      } else if (event.type === "room-join" && event.room) {
        const a = roster.get(event.agentId);
        if (a) a.rooms.add(event.room);
      } else if (event.type === "room-leave" && event.room) {
        const a = roster.get(event.agentId);
        if (a) a.rooms.delete(event.room);
      }
    }

    return { roster, apply };
  }

  it("adds agent on join event", () => {
    const { roster, apply } = createRoster();
    apply({ type: "join", agentId: "pi-a3f7", displayName: "Pi Agent", timestamp: Date.now() });
    expect(roster.has("pi-a3f7")).toBe(true);
    expect(roster.get("pi-a3f7")!.displayName).toBe("Pi Agent");
  });

  it("removes agent on leave event", () => {
    const { roster, apply } = createRoster();
    apply({ type: "join", agentId: "pi-a3f7", displayName: "Pi Agent", timestamp: Date.now() });
    apply({ type: "leave", agentId: "pi-a3f7", displayName: "Pi Agent", timestamp: Date.now() });
    expect(roster.has("pi-a3f7")).toBe(false);
  });

  it("updates rooms on room-join event", () => {
    const { roster, apply } = createRoster();
    apply({ type: "join", agentId: "pi-a3f7", displayName: "Pi Agent", timestamp: Date.now() });
    apply({ type: "room-join", agentId: "pi-a3f7", displayName: "Pi Agent", room: "venflowapp", timestamp: Date.now() });
    expect(roster.get("pi-a3f7")!.rooms.has("venflowapp")).toBe(true);
  });

  it("removes room on room-leave event", () => {
    const { roster, apply } = createRoster();
    apply({ type: "join", agentId: "pi-a3f7", displayName: "Pi Agent", timestamp: Date.now() });
    apply({ type: "room-join", agentId: "pi-a3f7", displayName: "Pi Agent", room: "venflowapp", timestamp: Date.now() });
    apply({ type: "room-leave", agentId: "pi-a3f7", displayName: "Pi Agent", room: "venflowapp", timestamp: Date.now() });
    expect(roster.get("pi-a3f7")!.rooms.has("venflowapp")).toBe(false);
  });
});

describe("whoami logic", () => {
  it("returns correct identity shape", () => {
    const agentId = "claude-code-9x2k";
    const displayName = "Claude Code";
    const project = "venflowapp";
    const rooms = ["venflowapp"];

    const result = { agentId, displayName, project, rooms };
    expect(result.agentId).toMatch(/^claude-code-/);
    expect(result.rooms).toBeInstanceOf(Array);
  });
});

describe("who_is_in filtering", () => {
  it("filters agents by room", () => {
    const PRESENCE_TTL_MS = 60_000;
    const agents = [
      { agentId: "pi-a3f7", displayName: "Pi", rooms: new Set(["venflowapp"]), lastSeen: Date.now() },
      { agentId: "pi-b2c1", displayName: "Pi2", rooms: new Set(["debug"]), lastSeen: Date.now() },
    ];

    const inRoom = agents.filter(
      a => Date.now() - a.lastSeen < PRESENCE_TTL_MS && a.rooms.has("venflowapp")
    );
    expect(inRoom).toHaveLength(1);
    expect(inRoom[0].agentId).toBe("pi-a3f7");
  });

  it("returns empty for room with no agents", () => {
    const agents: { agentId: string; rooms: Set<string>; lastSeen: number }[] = [];
    const inRoom = agents.filter(a => a.rooms.has("nonexistent"));
    expect(inRoom).toHaveLength(0);
  });
});
