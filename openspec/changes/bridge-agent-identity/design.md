## Context

El sistema de presencia actual usa un solo subject (`bridge.{project}.presence`) con payloads simples `{ agent, status }`. No hay distinción entre "quién soy" y "sigo vivo". El nombre del agente es hardcodeado en cada paquete y no es único — dos instancias de Pi colisionarían.

## Goals / Non-Goals

**Goals:**
- Cada agente tiene un ID único generado al conectarse (`{base}-{random4}`)
- Cada agente puede configurar un `displayName` legible via env var `BRIDGE_DISPLAY_NAME`
- Los agentes saben en qué rooms están y quién más está en cada room
- Claude Code puede preguntar `whoami` y `who_is_in`
- La extensión Pi mantiene un roster local de agentes y rooms

**Non-Goals:**
- Autenticación o autorización entre agentes
- Persistencia del roster entre sesiones (en memory únicamente)
- Migración automática de agentes sin la nueva versión

## Decisions

### D1: Subject `registry` separado de `presence`

`presence` sigue siendo el heartbeat (livingness). `registry` es para eventos de identidad: join, leave, room-join, room-leave.

```
bridge.{project}.presence   → "sigo vivo" (heartbeat cada 30s)
bridge.{project}.registry   → "me registré", "entré al room X", "salí del room Y"
```

Separar los dos evita contaminar el heartbeat con datos de identidad y mantiene ambos livianos.

### D2: ID único generado localmente

```typescript
// base + 4 chars aleatorios
const agentId = `${AGENT_BASE}-${Math.random().toString(36).slice(2,6)}`
// "pi-a3f7", "claude-code-9x2k"
```

`AGENT_BASE` es `"pi"` en la extensión y `"claude-code"` en el MCP. `BRIDGE_AGENT_ID` env var permite forzar un ID fijo (útil para producción).

### D3: Payload de registro

```typescript
interface RegistryEvent {
  type: "join" | "leave" | "room-join" | "room-leave"
  agentId: string        // "pi-a3f7"
  displayName: string    // "Pi Agent" o BRIDGE_DISPLAY_NAME
  room?: string          // solo en room-join / room-leave
  timestamp: number
}
```

### D4: AgentPresence extendido

```typescript
interface AgentPresence {
  agentId: string
  displayName: string
  rooms: Set<string>
  joinedAt: number
  lastSeen: number
}
```

El roster se construye escuchando tanto `presence` (para lastSeen) como `registry` (para displayName y rooms).

### D5: Tools nuevas en MCP

- `whoami` → retorna `{ agentId, displayName, project, rooms }` de Claude Code mismo
- `who_is_in { room }` → retorna lista de agentes en ese room con su displayName
- `list_agents` → actualizado para incluir `displayName` y `rooms` en cada entrada

### D6: Pi mantiene roster local pero no expone tools nuevas de consulta

La extensión Pi actualiza su roster interno para que Pi pueda referenciar agentes por nombre al usar `agent_bridge`. No agrega tools de consulta — Pi puede pedirle el roster a Claude Code via bridge si lo necesita.

## Risks / Trade-offs

- **Race condition en registro**: si dos agentes se registran simultáneamente, ambos escuchan el registry del otro. Es eventual consistency — en milisegundos el roster converge. Aceptable.
- **ID collision**: probabilidad de colisión con 4 chars base36 y pocos agentes es ~0.1%. Si ocurre, `BRIDGE_AGENT_ID` env var permite forzar IDs únicos.
- **Agentes legacy**: agentes con versión anterior no publican en `registry`. Siguen apareciendo en `list_agents` vía presencia, con `displayName: agentId` y `rooms: []`.
