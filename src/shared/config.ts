import { basename, resolve } from "node:path";

export function getProject(): string {
  return process.env.BRIDGE_PROJECT ?? basename(resolve("."));
}

export function generateAgentId(base: string): string {
  if (process.env.BRIDGE_AGENT_ID) return process.env.BRIDGE_AGENT_ID;
  const suffix = Math.random().toString(36).slice(2, 6);
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
