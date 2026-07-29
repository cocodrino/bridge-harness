#!/usr/bin/env node
// Interactive installer for the agent-bridge skill: pick which agents to install it into.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();

function log(m: string) {
  process.stdout.write(m + "\n");
}

function which(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface Agent {
  key: string;
  name: string;
  skillsDir: string;
  detect: () => boolean;
}

// Agents that host the bridge skill, with their skills directory. Extend as needed.
const AGENTS: Agent[] = [
  {
    key: "claude",
    name: "Claude Code",
    skillsDir: join(HOME, ".claude", "skills"),
    detect: () => existsSync(join(HOME, ".claude")) || which("claude"),
  },
  {
    key: "pi",
    name: "Pi",
    skillsDir: join(HOME, ".pi", "agent", "skills"),
    detect: () => existsSync(join(HOME, ".pi", "agent")) || which("pi"),
  },
  {
    key: "codex",
    name: "Codex CLI",
    skillsDir: join(HOME, ".codex", "skills"),
    detect: () => existsSync(join(HOME, ".codex")) || which("codex"),
  },
];

function getSkillSource(): string {
  // skills/ sits at the package root; resolve locally or from the npm global install.
  const p = resolve(__dirname, "../../skills/agent-bridge/SKILL.md");
  if (existsSync(p)) return p;
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return join(globalRoot, "@cocodrino", "bridge-harness", "skills", "agent-bridge", "SKILL.md");
  } catch {
    return p;
  }
}

function installTo(agent: Agent, src: string, force: boolean): "installed" | "skipped" | "error" {
  const destDir = join(agent.skillsDir, "agent-bridge");
  const dest = join(destDir, "SKILL.md");
  if (existsSync(dest) && !force) return "skipped";
  try {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    return "installed";
  } catch {
    return "error";
  }
}

function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

function isInstalled(agent: Agent): boolean {
  return existsSync(join(agent.skillsDir, "agent-bridge", "SKILL.md"));
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");
  const allFlag = args.includes("--all") || args.includes("-a");

  const src = getSkillSource();
  if (!existsSync(src)) {
    log("✗ agent-bridge skill source not found.");
    process.exit(1);
  }

  log("\n🌉 Install the agent-bridge skill\n");
  AGENTS.forEach((a, i) => {
    const present = a.detect();
    const has = isInstalled(a);
    const tags = [present ? "" : "not detected", has ? "already installed" : ""].filter(Boolean).join(", ");
    log(`  ${i + 1}) ${a.name.padEnd(12)}${tags ? "  (" + tags + ")" : ""}`);
  });

  const detected = AGENTS.filter((a) => a.detect());

  let chosen: Agent[];
  if (allFlag) {
    chosen = AGENTS;
  } else if (!process.stdin.isTTY) {
    chosen = detected.length ? detected : AGENTS;
    log(`\nNon-interactive — installing to: ${chosen.map((a) => a.name).join(", ") || "(none)"}`);
  } else {
    const ans = await ask("\nInstall to which? (comma-separated numbers, 'all', or Enter for all detected): ");
    if (ans === "") chosen = detected;
    else if (ans.toLowerCase() === "all") chosen = AGENTS;
    else {
      const idx = ans
        .split(/[,\s]+/)
        .map((n) => parseInt(n, 10) - 1)
        .filter((n) => n >= 0 && n < AGENTS.length);
      chosen = [...new Set(idx)].map((i) => AGENTS[i]);
    }
  }

  if (!chosen.length) {
    log("\nNothing selected. Exiting.\n");
    return;
  }

  log("");
  for (const a of chosen) {
    const r = installTo(a, src, force);
    if (r === "installed") log(`  ✓ ${a.name}: installed to ${a.skillsDir}/agent-bridge/`);
    else if (r === "skipped") log(`  ⚠ ${a.name}: already present — skipped (use --force to overwrite)`);
    else log(`  ✗ ${a.name}: could not install (check permissions for ${a.skillsDir})`);
  }
  log("\nDone. Restart the agent to load the skill.\n");
}

main().catch((e) => {
  log("✗ " + (e as Error).message);
  process.exit(1);
});
