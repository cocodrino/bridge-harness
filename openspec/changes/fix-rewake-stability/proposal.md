## Why

El asyncRewake hook dejó de despertar a Claude Code automáticamente cuando Pi envía mensajes. La causa raíz es un **project name mismatch**: el hook `bridge-rewake.js` corre como proceso hijo de Claude Code, hereda su `cwd()`, y usa `basename(cwd())` como project. Si Claude Code se inicia desde un directorio diferente al esperado, el hook escucha en un subject distinto al que usa el MCP server. Hay también un riesgo secundario del lado de Pi: si Pi usa un ID dinámico, otros agentes que no conocen el ID no pueden enviarle DMs.

## What Changes

- El MCP server escribe `~/.bridge-harness-state.json` al iniciar con `{ project, agentId, dmSubject, pidFile }` — la fuente de verdad para el hook
- El hook `bridge-rewake.js` lee este state file para saber exactamente a qué subject suscribirse, sin depender de env vars ni de cwd
- El MCP server siempre suscribe a TANTO el ID dinámico (`claude-code-9x2k`) COMO el nombre canónico (`claude-code`) — el hook suscribe al canónico
- La extensión Pi siempre suscribe a TANTO `pi-{random}` (dinámico) COMO `pi` (canónico) — cualquier agente puede enviar a `agent:pi` sin conocer el ID dinámico
- `agent_bridge` de Pi usa `claude-code` como destino canónico por defecto

## Capabilities

### New Capabilities

- `mcp-state-file`: el MCP server escribe y limpia un state file con su configuración activa

### Modified Capabilities

- `rewake-hook`: lee el state file en lugar de inferir el subject por cwd
- `pi-identity`: garantiza suscripción canónica `pi` además del ID dinámico

## Impact

- `src/mcp-server/index.ts` — escribe/limpia `~/.bridge-harness-state.json`
- `hooks/bridge-rewake.js` — lee state file para obtener project y dmSubject
- `packages/bridge-harness-pi/src/index.ts` — agrega suscripción canónica `pi`
- Backwards compatible: si el state file no existe, el hook cae back a `BRIDGE_PROJECT ?? basename(cwd())`
