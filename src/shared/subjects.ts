// Routing model:
//   - DMs and discovery (registry / presence / system) are GLOBAL — not namespaced
//     by project — so any agent can message or find any other agent by identity,
//     even across git worktrees / projects.
//   - Rooms stay project-scoped, so each worktree keeps an isolated lobby.
export const subjects = {
  room: (project: string, room: string) => `bridge.${project}.room.${room}`,
  roomWildcard: (project: string) => `bridge.${project}.room.*`,
  dm: (agentId: string) => `bridge.dm.${agentId}`,
  presence: () => `bridge.presence`,
  registry: () => `bridge.registry`,
  system: () => `bridge.system`,
} as const;
