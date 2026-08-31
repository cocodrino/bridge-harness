import { describe, it, expect } from "vitest";
import { applyPresenceEvent } from "../../src/shared/presence.js";
import type { AgentPresence } from "../../src/shared/types.js";

const SELF = "claude-code-1234";

function roster(): Map<string, AgentPresence> {
  return new Map<string, AgentPresence>();
}

function peer(agentId: string, rooms: string[] = []): AgentPresence {
  return {
    agentId,
    displayName: agentId,
    project: "bridge-harness",
    rooms: new Set(rooms),
    aliases: new Set(),
    joinedAt: 1_000,
    lastSeen: 1_000,
  };
}

describe("applyPresenceEvent — self filtering", () => {
  it("ignores our own heartbeat instead of creating a phantom entry", () => {
    const r = roster();

    const changed = applyPresenceEvent(r, { agent: SELF, status: "active", project: "bridge-harness" }, SELF);

    expect(changed).toBe(false);
    expect(r.size).toBe(0);
  });

  it("never lets our own heartbeat appear in the roster with empty rooms (the reported bug)", () => {
    const r = roster();

    // Simulate the real loop: we join a room, then our own heartbeat comes back to us.
    // Before the fix this created a self entry whose rooms could never fill, so
    // list_agents showed us in no rooms while whoami showed the room correctly.
    for (let i = 0; i < 5; i++) {
      applyPresenceEvent(r, { agent: SELF, status: "active", project: "bridge-harness" }, SELF);
    }

    expect(r.has(SELF)).toBe(false);
  });

  it("ignores our own offline heartbeat too", () => {
    const r = roster();
    r.set("pi-abc", peer("pi-abc"));

    applyPresenceEvent(r, { agent: SELF, status: "offline" }, SELF);

    expect(r.size).toBe(1);
    expect(r.has("pi-abc")).toBe(true);
  });
});

describe("applyPresenceEvent — peers", () => {
  it("adds an unknown peer with no rooms and no aliases", () => {
    const r = roster();

    applyPresenceEvent(r, { agent: "pi-abc", status: "active", project: "vela-lang" }, SELF, 5_000);

    const entry = r.get("pi-abc")!;
    expect(entry.agentId).toBe("pi-abc");
    expect(entry.project).toBe("vela-lang");
    expect([...entry.rooms]).toEqual([]);
    expect(entry.joinedAt).toBe(5_000);
    expect(entry.lastSeen).toBe(5_000);
  });

  it("refreshes lastSeen on a known peer without wiping its rooms", () => {
    const r = roster();
    r.set("pi-abc", peer("pi-abc", ["bridge-harness"]));

    applyPresenceEvent(r, { agent: "pi-abc", status: "active" }, SELF, 9_000);

    const entry = r.get("pi-abc")!;
    expect(entry.lastSeen).toBe(9_000);
    expect(entry.joinedAt).toBe(1_000);
    expect([...entry.rooms]).toEqual(["bridge-harness"]);
  });

  it("updates a known peer's project when the heartbeat carries one", () => {
    const r = roster();
    r.set("pi-abc", peer("pi-abc"));

    applyPresenceEvent(r, { agent: "pi-abc", status: "active", project: "other-repo" }, SELF);

    expect(r.get("pi-abc")!.project).toBe("other-repo");
  });

  it("leaves the project untouched when the heartbeat omits it", () => {
    const r = roster();
    r.set("pi-abc", peer("pi-abc"));

    applyPresenceEvent(r, { agent: "pi-abc", status: "active" }, SELF);

    expect(r.get("pi-abc")!.project).toBe("bridge-harness");
  });

  it("removes a peer that goes offline", () => {
    const r = roster();
    r.set("pi-abc", peer("pi-abc"));

    const changed = applyPresenceEvent(r, { agent: "pi-abc", status: "offline" }, SELF);

    expect(changed).toBe(true);
    expect(r.has("pi-abc")).toBe(false);
  });
});
