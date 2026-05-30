export const subjects = {
  room: (project: string, room: string) => `bridge.${project}.room.${room}`,
  dm: (project: string, agentId: string) => `bridge.${project}.dm.${agentId}`,
  presence: (project: string) => `bridge.${project}.presence`,
  registry: (project: string) => `bridge.${project}.registry`,
  system: (project: string) => `bridge.${project}.system`,
  roomWildcard: (project: string) => `bridge.${project}.room.*`,
} as const;
