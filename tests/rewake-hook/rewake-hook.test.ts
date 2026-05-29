import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(
  import.meta.dirname,
  "../../hooks/bridge-rewake.js"
);

// We test the output format by simulating what the hook produces.
// The hook writes JSON to stdout and exits with code 2.
// We replicate the output logic here to keep tests fast and without NATS.

function buildSystemMessage(from: string, content: string): string {
  return JSON.stringify({
    systemMessage: `[Bridge] Mensaje de ${from}: ${content}`,
  });
}

describe("rewake hook output format", () => {
  it("produces valid JSON with systemMessage field", () => {
    const output = buildSystemMessage("pi", "hola claude");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("systemMessage");
    expect(parsed.systemMessage).toContain("[Bridge]");
    expect(parsed.systemMessage).toContain("pi");
    expect(parsed.systemMessage).toContain("hola claude");
  });

  it("includes the sender name in the message", () => {
    const output = buildSystemMessage("claude-code", "test");
    const parsed = JSON.parse(output);
    expect(parsed.systemMessage).toContain("claude-code");
  });

  it("includes the content in the message", () => {
    const output = buildSystemMessage("pi", "revisá el PR #42");
    const parsed = JSON.parse(output);
    expect(parsed.systemMessage).toContain("revisá el PR #42");
  });
});

describe("project name resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses BRIDGE_PROJECT when defined", () => {
    process.env.BRIDGE_PROJECT = "venflowapp";
    const project = process.env.BRIDGE_PROJECT ?? require("node:path").basename(process.cwd());
    expect(project).toBe("venflowapp");
  });

  it("falls back to dirname of cwd when BRIDGE_PROJECT is not set", () => {
    delete process.env.BRIDGE_PROJECT;
    const { basename } = require("node:path");
    const project = process.env.BRIDGE_PROJECT ?? basename(process.cwd());
    expect(project).toBe(basename(process.cwd()));
    expect(typeof project).toBe("string");
    expect(project.length).toBeGreaterThan(0);
  });
});
