## Why

El sistema de presencia actual es ciego: los agentes publican heartbeats con nombres hardcodeados, no saben cómo los ven los demás, y no hay forma de saber quién está en qué room. Si conectás dos instancias del mismo agente, colisionan. Si querés saber quién está en un room específico, no podés. Esto limita la coordinación multi-agent.

## What Changes

- Cada agente se registra al conectarse con un ID único (`pi-a3f7`) y un `displayName` opcional elegible por el usuario
- Nuevo subject `bridge.{project}.registry` para anuncios de registro, join y leave de rooms
- `list_agents` devuelve agentes con rooms incluidos, no solo heartbeat timestamp
- Nuevo tool `whoami` en el MCP server — Claude Code sabe cómo lo ven los demás agentes
- Nuevo tool `who_is_in` — lista los agentes conectados a un room específico
- La extensión Pi anuncia su identidad al conectarse y actualiza su roster cuando otros se unen/salen
- Tanto el MCP server como la extensión Pi implementan el protocolo completo

## Capabilities

### New Capabilities

- `agent-registry`: protocolo de registro de identidad — subject, payload, ID único, displayName
- `mcp-identity-tools`: tools `whoami` y `who_is_in` en el MCP server; `list_agents` mejorado con rooms
- `pi-identity`: registro de identidad y room roster en la extensión Pi

### Modified Capabilities

## Impact

- `src/shared/subjects.ts` — agregar subject `registry`
- `src/shared/config.ts` — agregar generación de ID único
- `src/mcp-server/index.ts` — registro al conectar, `AgentPresence` extendido, tools nuevas
- `packages/bridge-harness-pi/src/index.ts` — registro al conectar, roster local, room awareness
- Backwards compatible: agentes sin la nueva versión siguen funcionando vía presencia
