## 1. Shared: subjects y config

- [x] 1.1 Agregar `registry: (project: string) => string` a `src/shared/subjects.ts`
- [x] 1.2 Agregar `generateAgentId(base: string): string` a `src/shared/config.ts` — lee `BRIDGE_AGENT_ID` o genera `{base}-{random4}`
- [x] 1.3 Agregar `getDisplayName(fallback: string): string` — lee `BRIDGE_DISPLAY_NAME` o usa el fallback

## 2. Tipos compartidos

- [x] 2.1 Definir interface `RegistryEvent` en `src/shared/types.ts` con `type`, `agentId`, `displayName`, `room?`, `timestamp`
- [x] 2.2 Actualizar interface `AgentPresence` para incluir `displayName`, `rooms: Set<string>`, `joinedAt`

## 3. MCP Server — identidad y registro

- [x] 3.1 Generar `agentId` y `displayName` de Claude Code al iniciar usando `generateAgentId("claude-code")`
- [x] 3.2 Publicar evento `join` en `registry` al conectar a NATS
- [x] 3.3 Suscribir a `registry` para mantener roster de agentes actualizado (join/leave/room-join/room-leave)
- [x] 3.4 Publicar evento `room-join` en `registry` cuando Claude Code llama `join_room`
- [x] 3.5 Publicar evento `leave` en `registry` en el cleanup al cerrar el proceso

## 4. MCP Server — tools nuevas y actualizadas

- [x] 4.1 Implementar tool `whoami` — retorna identidad completa de Claude Code (agentId, displayName, project, rooms)
- [x] 4.2 Implementar tool `who_is_in { room }` — filtra roster por agentes que tienen ese room
- [x] 4.3 Actualizar tool `list_agents` para incluir `displayName` y `rooms` en cada entrada

## 5. Pi Extension — identidad y registro

- [x] 5.1 Generar `agentId` y `displayName` de Pi al iniciar usando `generateAgentId("pi")` (o importar la lógica directamente)
- [x] 5.2 Publicar evento `join` en `registry` al conectar a NATS en `session_start`
- [x] 5.3 Suscribir a `registry` para mantener roster local (join/leave/room-join/room-leave de otros agentes)
- [x] 5.4 Publicar evento `room-join` en `registry` al suscribir al wildcard de rooms
- [x] 5.5 Publicar evento `leave` en `registry` en `session_shutdown` antes de drain
- [x] 5.6 Usar `agentId` dinámico como `from` en mensajes enviados via `agent_bridge`

## 6. Tests unitarios

- [x] 6.1 Unit test `generateAgentId`: formato correcto, unicidad en múltiples llamadas, respeta `BRIDGE_AGENT_ID`
- [x] 6.2 Unit test `getDisplayName`: usa env var cuando está definida, usa fallback cuando no
- [x] 6.3 Unit test roster MCP: `join` agrega agente, `leave` lo elimina, `room-join` actualiza rooms
- [x] 6.4 Unit test tool `whoami`: retorna identidad correcta incluyendo rooms actuales
- [x] 6.5 Unit test tool `who_is_in`: filtra correctamente por room, retorna vacío para room sin agentes
- [x] 6.6 Unit test `list_agents` actualizado: incluye displayName y rooms

## 7. Validación

- [x] 7.1 Test de integración: Claude Code y Pi se conectan → ambos aparecen en `list_agents` con displayName y rooms
- [x] 7.2 Test de integración: `who_is_in room: "venflowapp"` retorna ambos agentes cuando están en el room
- [x] 7.3 Test de integración: `whoami` retorna el agentId único generado (no hardcodeado)
