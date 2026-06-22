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

// When running under cmux, resolve the human-readable name of the current surface
// so multiple instances are distinguishable on the bridge. Returns null outside cmux.
function getCmuxSurfaceName(): string | null {
  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (!surfaceId) return null; // not running under cmux
  const bin = process.env.CMUX_BUNDLED_CLI_PATH ?? "cmux";
  try {
    const out = execFileSync(bin, ["tree", "--all", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    let raw: string | null = null;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.here === true && typeof n.title === "string") raw = n.title as string;
      for (const key of Object.keys(n)) {
        const v = n[key];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(JSON.parse(out));
    const custom = raw && asCustomName(raw);
    if (custom) return custom;
  } catch {
    // cmux CLI unavailable — fall through to the id-based label
  }
  return `cmux:${surfaceId.slice(0, 8).toLowerCase()}`;
}

// A surface title is a user-set custom name only if it doesn't start with a status
// glyph/spinner and is a short slug (≤24 chars, ≤2 words). Otherwise it's a dynamic
// agent task title — return null so the caller falls back to a stable short id.
function asCustomName(raw: string): string | null {
  const startsWithGlyph = /^[^\p{L}\p{N}]/u.test(raw);
  const clean = raw.replace(/\s+/g, " ").trim();
  const looksCustom = !startsWithGlyph && clean.length > 0 && clean.length <= 24 && clean.split(" ").length <= 2;
  return looksCustom ? clean : null;
}

export function getDisplayName(fallback: string): string {
  if (process.env.BRIDGE_DISPLAY_NAME) return process.env.BRIDGE_DISPLAY_NAME;
  const surface = getCmuxSurfaceName();
  return surface ? `${fallback} @ ${surface}` : fallback;
}

export const NATS_URL = "nats://localhost:4222";
export const PRESENCE_INTERVAL_MS = 30_000;
export const PRESENCE_TTL_MS = 60_000;
export const NATS_START_TIMEOUT_MS = 5_000;
export const NATS_RETRY_INTERVAL_MS = 200;
