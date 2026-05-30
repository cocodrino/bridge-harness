export interface RegistryEvent {
  type: "join" | "leave" | "room-join" | "room-leave";
  agentId: string;
  displayName: string;
  room?: string;
  timestamp: number;
}

export interface AgentPresence {
  agentId: string;
  displayName: string;
  rooms: Set<string>;
  joinedAt: number;
  lastSeen: number;
}
