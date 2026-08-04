#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import {
  detectNatsInstalled,
  getNatsInstallInstructions,
  checkNatsRunning,
  startNatsServer,
} from "../nats-manager/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const SETTINGS_PATH = join(HOME, ".claude", "settings.json");
const CLAUDE_JSON_PATH = join(HOME, ".claude.json");

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

function success(msg: string) {
  log(`  ✓ ${msg}`);
}

function warn(msg: string) {
  log(`  ⚠ ${msg}`);
}

function error(msg: string) {
  log(`  ✗ ${msg}`);
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() === "" || answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

function isClaudeInstalled(): boolean {
  try {
    execSync("which claude", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getHookScriptPath(): string {
  // Resolve hook path relative to this file's location (works both locally and from npm global)
  const hookPath = resolve(__dirname, "../../hooks/bridge-rewake.js");
  if (existsSync(hookPath)) return hookPath;
  // Fallback: look in npm global root
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return join(globalRoot, "@cocodrino", "bridge-harness", "hooks", "bridge-rewake.js");
  } catch {
    return hookPath;
  }
}

function getMcpServerPath(): string {
  const mcpPath = resolve(__dirname, "../mcp-server/index.js");
  if (existsSync(mcpPath)) return mcpPath;
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return join(globalRoot, "@cocodrino", "bridge-harness", "dist", "mcp-server", "index.js");
  } catch {
    return mcpPath;
  }
}

function getSkillSourcePath(): string {
  // skills/ lives at the package root; resolve it locally or from the npm global install.
  const skillPath = resolve(__dirname, "../../skills/agent-bridge/SKILL.md");
  if (existsSync(skillPath)) return skillPath;
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return join(globalRoot, "@cocodrino", "bridge-harness", "skills", "agent-bridge", "SKILL.md");
  } catch {
    return skillPath;
  }
}

function setupSkill(): boolean {
  const src = getSkillSourcePath();
  if (!existsSync(src)) {
    warn("agent-bridge skill source not found — skipping");
    return false;
  }
  const destDir = join(HOME, ".claude", "skills", "agent-bridge");
  const dest = join(destDir, "SKILL.md");
  // Don't clobber a possibly-customized existing copy — install only if missing.
  if (existsSync(dest)) {
    warn("agent-bridge skill already present — skipping (delete it and re-run to get the latest)");
    return false;
  }
  try {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    success("agent-bridge skill installed in ~/.claude/skills/");
    return true;
  } catch (err) {
    warn(`Could not install agent-bridge skill: ${(err as Error).message}`);
    return false;
  }
}

function setupMcp(): boolean {
  const mcpPath = getMcpServerPath();
  const claudeJson = readJson(CLAUDE_JSON_PATH) as {
    mcpServers?: Record<string, unknown>;
    projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
  };

  // Check global mcpServers
  const globalServers = claudeJson.mcpServers ?? {};
  if ("bridge-harness" in globalServers) {
    warn("MCP bridge-harness already registered — skipping");
    return false;
  }

  try {
    execSync(
      `claude mcp add bridge-harness node ${mcpPath}`,
      { stdio: "ignore" }
    );
    success("MCP server registered via claude CLI");
    return true;
  } catch {
    // Fallback: edit ~/.claude.json directly
    claudeJson.mcpServers = {
      ...globalServers,
      "bridge-harness": {
        command: "node",
        args: [mcpPath],
      },
    };
    writeJson(CLAUDE_JSON_PATH, claudeJson);
    success("MCP server registered in ~/.claude.json");
    return true;
  }
}

function setupHook(): boolean {
  const hookPath = getHookScriptPath();
  const settings = readJson(SETTINGS_PATH) as {
    hooks?: {
      Stop?: Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>;
    };
  };

  settings.hooks = settings.hooks ?? {};
  settings.hooks.Stop = settings.hooks.Stop ?? [];

  // Check if already configured
  const alreadyConfigured = settings.hooks.Stop.some((group) =>
    group.hooks?.some((h) => {
      const cmd = h.command as string | undefined;
      return cmd?.includes("bridge-rewake");
    })
  );

  if (alreadyConfigured) {
    warn("asyncRewake hook already configured — skipping");
    return false;
  }

  // Find existing wildcard group or create one
  let wildcardGroup = settings.hooks.Stop.find((g) => !g.matcher || g.matcher === "*");
  if (!wildcardGroup) {
    wildcardGroup = { matcher: "*", hooks: [] };
    settings.hooks.Stop.push(wildcardGroup);
  }

  wildcardGroup.hooks.push({
    type: "command",
    command: `node ${hookPath}`,
    asyncRewake: true,
    rewakeMessage:
      "Incoming message via NATS bridge. Call the `read` tool from MCP `bridge-harness` to read it and respond with `send` if appropriate.",
    rewakeSummary: "Incoming message from bridge",
  });

  writeJson(SETTINGS_PATH, settings);
  success("asyncRewake hook configured in ~/.claude/settings.json");
  return true;
}

async function setupNats(): Promise<void> {
  if (!detectNatsInstalled()) {
    error("nats-server not found in PATH.\n");
    log("  Install it with:\n");
    getNatsInstallInstructions().split("\n").forEach((line) => log(`    ${line}`));
    log("");
    process.exit(1);
  }
  success("nats-server detected");

  if (await checkNatsRunning()) {
    success("NATS server is running");
    return;
  }

  warn("NATS server is not running");

  const shouldStart = await ask("  Start it now? [Y/n] ");

  if (shouldStart) {
    try {
      startNatsServer();
      // Wait briefly for it to be ready
      await new Promise((r) => setTimeout(r, 800));
      if (await checkNatsRunning()) {
        success("NATS server started");
      } else {
        warn("NATS server may not have started — continuing anyway");
      }
    } catch (err) {
      warn(`Could not start NATS: ${(err as Error).message}`);
    }
  } else {
    log("\n  To start NATS manually:\n    nats-server &\n");
  }
}

async function main() {
  log("\n🌉 bridge-harness setup\n");

  if (!isClaudeInstalled()) {
    error("Claude Code not found. Install it first: https://claude.ai/code");
    process.exit(1);
  }
  success("Claude Code detected");

  await setupNats();

  setupMcp();
  setupHook();
  setupSkill();

  log("\n✅ Setup complete! Restart Claude Code to activate the bridge.\n");
  log("   Once restarted, the tools whoami, send, read, list_agents, join_room,");
  log("   who_is_in and use_bridge will be available; Claude Code reacts");
  log("   automatically to incoming messages, and the `agent-bridge` skill is");
  log("   installed to operate the bridge correctly.\n");
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
