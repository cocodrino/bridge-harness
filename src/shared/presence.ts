import type { AgentPresence } from "./types.js";

export interface PresenceEvent {
  agent: string;
  status: string;
  project?: string;
}

/**
 * Fold one presence heartbeat into the roster.
 *
 * Presence is a global broadcast, so an agent receives its OWN heartbeats. `self` must be
 * passed so they can be dropped: otherwise the agent invents a roster entry for itself
 * whose `rooms` stays empty forever — room membership only arrives via registry events,
 * and those already filter self. The visible symptom was `list_agents` reporting this
 * agent as being in no rooms while `whoami` correctly listed them.
 *
 * Pure apart from mutating the roster it is handed, so it can be unit-tested directly.
 * Returns true when the roster changed.
 */
export function applyPresenceEvent(
  roster: Map<string, AgentPresence>,
  event: PresenceEvent,
  self: string,
  now: number = Date.now()
): boolean {
  if (event.agent === self) return false;

  if (event.status === "offline") {
    return roster.delete(event.agent);
  }

  const existing = roster.get(event.agent);
  if (existing) {
    existing.lastSeen = now;
    if (event.project) existing.project = event.project;
    return true;
  }

  // First time we hear from this agent. Rooms/aliases stay empty until a registry event
  // fills them in; a heartbeat carries no membership information.
  roster.set(event.agent, {
    agentId: event.agent,
    displayName: event.agent,
    project: event.project,
    rooms: new Set(),
    aliases: new Set(),
    joinedAt: now,
    lastSeen: now,
  });
  return true;
}
