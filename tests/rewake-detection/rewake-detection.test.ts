import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasRewakeHook, readClaudeSettings, rewakeStatus } from "../../src/shared/rewake-hook.js";

const withHook = {
  hooks: {
    Stop: [
      {
        matcher: "*",
        hooks: [
          { type: "command", command: "bash '/Users/x/.claude/hooks/herdr-agent-state.sh' idle", timeout: 10 },
          { type: "command", command: "node /Users/x/proj/bridge-harness/hooks/bridge-rewake.js", asyncRewake: true },
        ],
      },
    ],
  },
};

// This is the exact shape found on the user's machine: a Stop hook exists, but it belongs
// to an unrelated tool. The old diagnosis mistook "there is a Stop hook" for "rewake is
// installed", which is why the missing hook went unnoticed.
const withOtherStopHookOnly = {
  hooks: {
    Stop: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: "bash '/Users/x/.claude/hooks/herdr-agent-state.sh' idle" }],
      },
    ],
  },
};

describe("hasRewakeHook", () => {
  it("detects the hook when a Stop command mentions bridge-rewake", () => {
    expect(hasRewakeHook(withHook)).toBe(true);
  });

  it("returns false when the only Stop hook belongs to another tool", () => {
    expect(hasRewakeHook(withOtherStopHookOnly)).toBe(false);
  });

  it("returns false when there are no hooks at all", () => {
    expect(hasRewakeHook({})).toBe(false);
    expect(hasRewakeHook({ hooks: {} })).toBe(false);
    expect(hasRewakeHook({ hooks: { Stop: [] } })).toBe(false);
  });

  it("does not match a mention outside the Stop event", () => {
    expect(
      hasRewakeHook({
        hooks: { PreToolUse: [{ matcher: "*", hooks: [{ command: "node bridge-rewake.js" }] }] },
      })
    ).toBe(false);
  });

  it("survives malformed settings without throwing", () => {
    expect(hasRewakeHook(null)).toBe(false);
    expect(hasRewakeHook(undefined)).toBe(false);
    expect(hasRewakeHook("nonsense")).toBe(false);
    expect(hasRewakeHook({ hooks: { Stop: "nope" } })).toBe(false);
    expect(hasRewakeHook({ hooks: { Stop: [{ matcher: "*" }] } })).toBe(false);
    expect(hasRewakeHook({ hooks: { Stop: [{ hooks: [{ command: 42 }] }] } })).toBe(false);
  });

  it("matches regardless of where the hook is installed from", () => {
    const npmGlobal = {
      hooks: {
        Stop: [{ hooks: [{ command: "node /opt/homebrew/lib/node_modules/@cocodrino/bridge-harness/hooks/bridge-rewake.js" }] }],
      },
    };
    expect(hasRewakeHook(npmGlobal)).toBe(true);
  });
});

describe("readClaudeSettings", () => {
  it("returns null when the file does not exist", () => {
    expect(readClaudeSettings(join(tmpdir(), "definitely-not-here-9f2a.json"))).toBeNull();
  });

  it("returns null on invalid JSON instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "bh-settings-"));
    const path = join(dir, "settings.json");
    writeFileSync(path, "{ broken", "utf8");
    expect(readClaudeSettings(path)).toBeNull();
  });

  it("parses a valid settings file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bh-settings-"));
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify(withHook), "utf8");
    expect(hasRewakeHook(readClaudeSettings(path))).toBe(true);
  });
});

describe("rewakeStatus", () => {
  it("reports installed with no warning when the hook is present", () => {
    const status = rewakeStatus(withHook)!;
    expect(status.installed).toBe(true);
    expect(status.warning).toBe("");
  });

  it("warns actionably when a Stop hook exists but rewake is missing", () => {
    const status = rewakeStatus(withOtherStopHookOnly)!;
    expect(status.installed).toBe(false);
    expect(status.warning).toContain("never wake this session");
    expect(status.warning).toContain("bridge-harness setup");
  });

  it("warns when there is no settings file at all", () => {
    const status = rewakeStatus(null)!;
    expect(status.installed).toBe(false);
    expect(status.warning).toContain("bridge-harness setup");
  });
});
