import { describe, it, expect } from "vitest";

// Replicates the DM-target resolution used by `send` on both hosts (mcp-server/index.ts
// and the Pi extension). The invariant under test: a DM addressed to a set_name ALIAS must
// route to the recipient's real agentId subject (bridge.dm.<agentId>), because that's the
// only DM subject the rewake hook + durable JetStream consumer watch. Publishing to
// bridge.dm.<alias> reaches the inbox but never wakes the peer.

interface Presence { agentId: string; aliases: Set<string>; }

function resolve(roster: Map<string, Presence>, target: string): Presence | undefined {
  const direct = roster.get(target);
  if (direct) return direct;
  for (const a of roster.values()) if (a.aliases.has(target)) return a;
  return undefined;
}

// The exact expression the fix introduces in both senders.
function dmTarget(roster: Map<string, Presence>, type: string, target: string): string {
  return type === "agent" ? (resolve(roster, target)?.agentId ?? target) : target;
}

describe("DM alias routing", () => {
  const roster = new Map<string, Presence>([
    ["claude-code-72729", { agentId: "claude-code-72729", aliases: new Set(["inngest-agent"]) }],
  ]);

  it("routes an alias to the recipient's real agentId (so the hook wakes them)", () => {
    expect(dmTarget(roster, "agent", "inngest-agent")).toBe("claude-code-72729");
  });

  it("leaves a direct agentId untouched", () => {
    expect(dmTarget(roster, "agent", "claude-code-72729")).toBe("claude-code-72729");
  });

  it("falls back to the literal target when the alias is unknown (best-effort)", () => {
    expect(dmTarget(roster, "agent", "ghost-name")).toBe("ghost-name");
  });

  it("never rewrites a room target", () => {
    expect(dmTarget(roster, "room", "inngest-agent")).toBe("inngest-agent");
  });
});
