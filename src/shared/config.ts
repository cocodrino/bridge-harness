import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export function getProject(): string {
  if (process.env.BRIDGE_PROJECT) return process.env.BRIDGE_PROJECT;
  // Use the git worktree root so each worktree gets its own isolated namespace.
  // basename(git toplevel) is stable no matter which subdirectory we launch from,
  // and for a linked worktree it resolves to the worktree's folder name.
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return basename(top);
  } catch {
    // not a git repo, or git unavailable — fall back to the cwd name
  }
  return basename(resolve("."));
}

export function generateAgentId(base: string): string {
  if (process.env.BRIDGE_AGENT_ID) return process.env.BRIDGE_AGENT_ID;
  // Use PPID so the asyncRewake hook (same parent process) can derive the same ID independently
  const suffix = process.ppid ?? Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

export function getDisplayName(fallback: string): string {
  return process.env.BRIDGE_DISPLAY_NAME ?? fallback;
}

export const NATS_URL = "nats://localhost:4222";
export const PRESENCE_INTERVAL_MS = 30_000;
export const PRESENCE_TTL_MS = 60_000;
export const NATS_START_TIMEOUT_MS = 5_000;
export const NATS_RETRY_INTERVAL_MS = 200;
