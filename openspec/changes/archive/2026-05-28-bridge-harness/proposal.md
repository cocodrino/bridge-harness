## Why

`agent-comms` (la librería que usábamos para comunicar Claude Code y Pi) está mal mantenida: publica el paquete sin buildear los assets de Vite, lo que causa un crash en runtime, y su modelo de reactivity para Pi no funciona de forma confiable. Necesitamos un transport propio, simple y sin dependencias frágiles.

## What Changes

- Nuevo paquete npm `bridge-harness` construido desde cero en TypeScript puro (sin Vite, sin Web UI)
- MCP server para Claude Code con tools: `send`, `read`, `list_agents`, `join_room`
- Extensión Pi que conecta a NATS en `session_start` y usa `pi.sendMessage({ triggerTurn: true })` para reactividad automática
- NATS server con auto-start (si no hay uno corriendo en `localhost:4222`, lo levanta automáticamente)
- CLI de debug: `bridge send`, `bridge read`, `bridge agents`
- Reemplaza completamente `agent-comms` — **BREAKING**: los agentes deben migrar al nuevo package

## Capabilities

### New Capabilities

- `nats-server`: Gestión del servidor NATS embebido — auto-start, health check, shutdown
- `mcp-server`: MCP server para Claude Code con las tools de comunicación sobre NATS
- `pi-extension`: Extensión Pi que suscribe a subjects NATS y dispara reactividad vía `pi.sendMessage`
- `bridge-cli`: CLI de debug para inspeccionar el mesh manualmente

### Modified Capabilities

## Impact

- Elimina dependencia de `agent-comms` y su coordinator TCP
- Introduce `nats` (cliente Node.js) y el binario `nats-server` como dependencias
- Build: solo `tsc`, sin Vite ni assets estáticos en runtime
- Dos entry points: `bridge-harness mcp` (Claude Code) y el package de Pi como extensión independiente
