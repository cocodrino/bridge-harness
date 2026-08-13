import { describe, it, expect } from "vitest";
import { spawnAgentTab, type Runner } from "../../src/spawn/spawn.js";
import { buildAgentCommand } from "../../src/spawn/command.js";
import { type SpawnCapability } from "../../src/spawn/probe.js";

const cmd = buildAgentCommand({ tool: "pi", name: "verifier", task: "check X", requester: "claude-code-1" });

// Records every (file, args) the dispatcher runs, and returns canned stdout.
function recorder(stdout = ""): { run: Runner; calls: Array<{ file: string; args: string[] }> } {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: Runner = (file, args) => { calls.push({ file, args }); return stdout; };
  return { run, calls };
}

const cap = (backend: SpawnCapability["backend"], canSpawnTab: boolean): SpawnCapability =>
  ({ backend, canSpawnTab, method: "cmux-cli", detail: `${backend} test` });

describe("spawnAgentTab", () => {
  it("cmux: creates a pane, parses the surface ref, then types the command + Enter", () => {
    const { run, calls } = recorder("OK surface:89 pane:28 workspace:3");
    const res = spawnAgentTab(cmd, cap("cmux", true), { CMUX_BUNDLED_CLI_PATH: "/bin/cmux" }, run);
    expect(res.spawned).toBe(true);
    expect(calls[0]).toEqual({ file: "/bin/cmux", args: ["new-pane", "--type", "terminal", "--direction", "down", "--focus", "true"] });
    expect(calls[1]).toEqual({ file: "/bin/cmux", args: ["send", "--surface", "surface:89", cmd.shell] });
    expect(calls[2]).toEqual({ file: "/bin/cmux", args: ["send-key", "--surface", "surface:89", "Enter"] });
  });

  it("cmux: degrades to manual when new-pane returns no surface ref", () => {
    const { run } = recorder("weird output, no ref");
    const res = spawnAgentTab(cmd, cap("cmux", true), {}, run);
    expect(res.spawned).toBe(false);
    expect(res.manualCommand).toBe(cmd.shell);
  });

  it("tmux: opens a named window in one shot", () => {
    const { run, calls } = recorder();
    const res = spawnAgentTab(cmd, cap("tmux", true), {}, run);
    expect(res.spawned).toBe(true);
    expect(calls[0]).toEqual({ file: "tmux", args: ["new-window", "-n", "verifier", cmd.shell] });
  });

  it("zellij: passes argv after -- (no shell quoting)", () => {
    const { run, calls } = recorder();
    const res = spawnAgentTab(cmd, cap("zellij", true), {}, run);
    expect(res.spawned).toBe(true);
    expect(calls[0]).toEqual({ file: "zellij", args: ["run", "--name", "verifier", "--", ...cmd.argv] });
  });

  it("emulator: never runs anything, returns the manual command", () => {
    const { run, calls } = recorder();
    const res = spawnAgentTab(cmd, cap("emulator", false), {}, run);
    expect(res.spawned).toBe(false);
    expect(res.manualCommand).toBe(cmd.shell);
    expect(calls).toHaveLength(0);
  });

  it("degrades to manual (never throws) when the runner fails", () => {
    const run: Runner = () => { throw new Error("cmux socket down"); };
    const res = spawnAgentTab(cmd, cap("cmux", true), {}, run);
    expect(res.spawned).toBe(false);
    expect(res.manualCommand).toBe(cmd.shell);
    expect(res.detail).toContain("cmux socket down");
  });
});
