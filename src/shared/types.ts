export interface RegistryEvent {
  // who-there: active discovery query. here: identity response carrying full presence.
  type: "join" | "leave" | "room-join" | "room-leave" | "who-there" | "here";
  agentId: string;
  displayName: string;
  room?: string;
  // Present on "here" responses: every room the responder is in.
  rooms?: string[];
  timestamp: number;
}

export interface AgentPresence {
  agentId: string;
  displayName: string;
  rooms: Set<string>;
  joinedAt: number;
  lastSeen: number;
}
