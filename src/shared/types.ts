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
  timestamp: number;
}

export interface AgentPresence {
  agentId: string;
  displayName: string;
  project?: string;
  rooms: Set<string>;
  joinedAt: number;
  lastSeen: number;
}
