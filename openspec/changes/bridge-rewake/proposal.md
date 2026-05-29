## Why

Claude Code actualmente no es reactivo: para leer mensajes de Pi hay que llamar `read` manualmente. El bridge ya funciona en ambas direcciones, pero requiere intervención del usuario para que Claude Code procese mensajes entrantes. Con `asyncRewake` hook, Claude Code se despierta automáticamente al recibir un mensaje de Pi, cerrando el ciclo sin intervención humana.

## What Changes

- Nuevo script de hook (`hooks/bridge-rewake.sh`) que escucha NATS y emite exit code 2 cuando llega un mensaje
- Configuración del hook en `~/.claude/settings.json` como `Stop` event con `asyncRewake: true`
- El MCP server expone un endpoint de escucha que el hook puede consultar para saber si hay mensajes pendientes
- Claude Code se despierta automáticamente, lee el inbox via tool `read`, procesa y responde a Pi

## Capabilities

### New Capabilities

- `rewake-hook`: Script de hook que monitorea mensajes entrantes de NATS y despierta a Claude Code via asyncRewake

### Modified Capabilities

## Impact

- Agrega un archivo de hook en el proyecto (`hooks/bridge-rewake.sh`)
- Modifica `~/.claude/settings.json` para registrar el hook en el evento `Stop`
- No modifica el MCP server ni la extensión Pi — son compatibles hacia atrás
