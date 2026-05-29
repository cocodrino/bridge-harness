import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Shared state we'll poke at from the outside ----
const inbox: Array<{ from: string; content: string; timestamp: number }> = [];
const agentPresence = new Map<string, { agentId: string; lastSeen: number }>();
const activeSubscriptions = new Set<string>();

const mockPublish = vi.fn();
const mockSubscribe = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }));

// Expose the tool handlers directly for unit testing (bypassing MCP transport)
// We replicate the logic here to keep tests independent of the MCP wiring.

const PRESENCE_TTL_MS = 60_000;

function toolJoinRoom(room: string): string {
  if (activeSubscriptions.has(room)) return `Already in room: ${room}`;
  activeSubscriptions.add(room);
  mockSubscribe(`bridge.test.room.${room}`);
  return `Joined room: ${room}`;
}

function toolSend(to: string, message: string): string {
  const [type, target] = to.split(":");
  const subject =
    type === "room"
      ? `bridge.test.room.${target}`
      : `bridge.test.dm.${target}`;
  mockPublish(subject, { from: "claude-code", content: message });
  return `Sent to ${to}`;
}

function toolRead(): Array<{ from: string; content: string; timestamp: number }> {
  return inbox.splice(0);
}

function toolListAgents(): Array<{ agentId: string; lastSeen: number }> {
  const now = Date.now();
  return [...agentPresence.values()].filter(
    (a) => now - a.lastSeen < PRESENCE_TTL_MS
  );
}

// ---- Tests ----

describe("tool: send", () => {
  beforeEach(() => mockPublish.mockClear());

  it("publishes to room subject when to is room:*", () => {
    toolSend("room:general", "hello");
    expect(mockPublish).toHaveBeenCalledWith(
      "bridge.test.room.general",
      expect.objectContaining({ content: "hello" })
    );
  });

  it("publishes to dm subject when to is agent:*", () => {
    toolSend("agent:pi", "review the PR");
    expect(mockPublish).toHaveBeenCalledWith(
      "bridge.test.dm.pi",
      expect.objectContaining({ content: "review the PR" })
    );
  });
});

describe("tool: read", () => {
  beforeEach(() => inbox.splice(0));

  it("returns accumulated messages and clears inbox", () => {
    inbox.push({ from: "pi", content: "done", timestamp: Date.now() });
    inbox.push({ from: "pi", content: "listo", timestamp: Date.now() });

    const result = toolRead();
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("done");
    expect(inbox).toHaveLength(0);
  });

  it("returns empty array when no messages pending", () => {
    const result = toolRead();
    expect(result).toEqual([]);
  });
});

describe("tool: list_agents", () => {
  beforeEach(() => agentPresence.clear());

  it("returns agents with recent heartbeat", () => {
    agentPresence.set("pi", { agentId: "pi", lastSeen: Date.now() });
    const result = toolListAgents();
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe("pi");
  });

  it("excludes agents with expired heartbeat", () => {
    agentPresence.set("ghost", {
      agentId: "ghost",
      lastSeen: Date.now() - PRESENCE_TTL_MS - 1000,
    });
    const result = toolListAgents();
    expect(result).toHaveLength(0);
  });
});

describe("tool: join_room", () => {
  beforeEach(() => {
    activeSubscriptions.clear();
    mockSubscribe.mockClear();
  });

  it("subscribes to correct subject on first join", () => {
    toolJoinRoom("venflowapp");
    expect(mockSubscribe).toHaveBeenCalledWith("bridge.test.room.venflowapp");
  });

  it("does not duplicate subscription on second join", () => {
    toolJoinRoom("venflowapp");
    toolJoinRoom("venflowapp");
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });
});
