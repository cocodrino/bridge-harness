export interface RegistryEvent {
  // who-there: active discovery query. here: identity response carrying full presence.
  type: "join" | "leave" | "room-join" | "room-leave" | "who-there" | "here";
  agentId: string;
  displayName: string;
  // The agent's project (git worktree). Discovery is global, so this tells you
  // WHERE each agent is even though you can reach them by ID regardless.
  project?: string;
  room?: string;
  // Present on "here" responses: every room the responder is in.
  rooms?: string[];
  // Memorable DM handles (set via set_name) this agent also answers to. Carried on
  // "join"/"here" so peers can resolve `agent:<alias>` to a live recipient.
  aliases?: string[];
  timestamp: number;
}

export interface AgentPresence {
  agentId: string;
  displayName: string;
  project?: string;
  rooms: Set<string>;
  // Memorable DM handles this agent also answers to (from set_name).
  aliases: Set<string>;
  joinedAt: number;
  lastSeen: number;
}
