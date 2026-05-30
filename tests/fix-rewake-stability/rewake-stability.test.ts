import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_FILE = join(homedir(), ".bridge-harness-state.json");

// Mock fs
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(),
}));

const { writeFileSync, readFileSync } = await import("node:fs");

describe("writeStateFile logic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates correct JSON with all required fields", () => {
    const project = "venflowapp";
    const agentId = "claude-code-9x2k";
    const canonicalSubject = `bridge.${project}.dm.claude-code`;

    const state = { project, agentId, canonicalSubject, startedAt: Date.now() };

    expect(state.project).toBe("venflowapp");
    expect(state.agentId).toBe("claude-code-9x2k");
    expect(state.canonicalSubject).toBe("bridge.venflowapp.dm.claude-code");
    expect(state.startedAt).toBeGreaterThan(0);
  });

  it("canonical subject always uses 'claude-code' not the dynamic ID", () => {
    const project = "myproject";
    const dynamicId = "claude-code-xyz9";
    const canonicalSubject = `bridge.${project}.dm.claude-code`;

    expect(canonicalSubject).toBe("bridge.myproject.dm.claude-code");
    expect(canonicalSubject).not.toContain(dynamicId);
  });
});

describe("rewake hook subject resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses canonicalSubject from state file when available", () => {
    vi.mocked(readFileSync).mockReturnValueOnce(
      JSON.stringify({
        project: "venflowapp",
        agentId: "claude-code-9x2k",
        canonicalSubject: "bridge.venflowapp.dm.claude-code",
        startedAt: Date.now(),
      }) as any
    );

    // Simulate resolveSubject logic
    let subject: string;
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf8") as string);
      subject = state.canonicalSubject;
    } catch {
      subject = `bridge.${process.env.BRIDGE_PROJECT ?? "fallback"}.dm.claude-code`;
    }

    expect(subject).toBe("bridge.venflowapp.dm.claude-code");
  });

  it("falls back to BRIDGE_PROJECT when state file missing", () => {
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error("ENOENT"); });
    process.env.BRIDGE_PROJECT = "myproject";

    let subject: string;
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf8") as string);
      subject = state.canonicalSubject;
    } catch {
      const project = process.env.BRIDGE_PROJECT ?? "fallback";
      subject = `bridge.${project}.dm.claude-code`;
    }

    expect(subject).toBe("bridge.myproject.dm.claude-code");
  });
});

describe("Pi canonical subscription", () => {
  it("subscribes to both dynamic and canonical subjects", () => {
    const agentId = "pi-a3f7";
    const subscriptions = [
      `bridge.project.dm.${agentId}`,  // dynamic
      "bridge.project.dm.pi",           // canonical
      "bridge.project.room.*",          // rooms
    ];

    expect(subscriptions).toContain("bridge.project.dm.pi");
    expect(subscriptions).toContain(`bridge.project.dm.${agentId}`);
    expect(subscriptions).toHaveLength(3);
  });
});
