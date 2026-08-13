import { describe, it, expect } from "vitest";
import { buildStartupPrompt, buildAgentCommand } from "../../src/spawn/command.js";

const base = { tool: "pi" as const, name: "test-verifier", task: "verify the login flow", requester: "claude-code-42" };

describe("buildStartupPrompt", () => {
  it("is a single line (no newlines — it gets typed into a terminal)", () => {
    const p = buildStartupPrompt(base);
    expect(p).not.toContain("\n");
  });

  it("tells the agent to set_name and DM the requester", () => {
    const p = buildStartupPrompt(base);
    expect(p).toContain('set_name "test-verifier"');
    expect(p).toContain("agent:claude-code-42");
    expect(p).toContain("verify the login flow");
  });

  it("uses the human display name in the prose when provided", () => {
    const p = buildStartupPrompt({ ...base, requesterDisplay: "Carlos" });
    expect(p).toContain("Carlos (agent:claude-code-42)");
  });
});

describe("buildAgentCommand", () => {
  it("launches pi with a positional prompt (NOT --prompt)", () => {
    const cmd = buildAgentCommand(base);
    expect(cmd.argv[0]).toBe("pi");
    expect(cmd.argv[1]).toBe(cmd.prompt);
    expect(cmd.shell).not.toContain("--prompt");
    expect(cmd.shell.startsWith("pi '")).toBe(true);
  });

  it("launches claude with a positional prompt", () => {
    const cmd = buildAgentCommand({ ...base, tool: "claude" });
    expect(cmd.argv[0]).toBe("claude");
    expect(cmd.shell.startsWith("claude '")).toBe(true);
  });

  it("single-quotes the prompt so it survives a shell paste", () => {
    const cmd = buildAgentCommand({ ...base, task: "handle O'Brien's case" });
    // the embedded apostrophe must be escaped as '\'' and not break out of quoting
    expect(cmd.shell).toContain(`'\\''`);
  });

  it("reuses the name as the tab label", () => {
    expect(buildAgentCommand(base).label).toBe("test-verifier");
  });
});
