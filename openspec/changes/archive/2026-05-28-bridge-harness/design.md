## Context

`agent-comms` proveía un mesh TCP entre Claude Code y Pi usando un coordinator en `localhost:19876`. Funcionaba pero el paquete publicado en npm omite los assets del build de Vite del frontend, causando un crash en runtime (`ENOENT: no such file or directory`). Adicionalmente, su mantenimiento es dudoso y la reactividad de Pi dependía de una extensión que hoy no funciona de forma confiable.

NATS.io resuelve el transport con un servidor embebido de ~20MB, pub/sub nativo, latencia sub-milisegundo en local, y clientes Node.js maduros. Elimina la necesidad de un Web UI completamente.

La reactividad de Pi se logra vía su API de extensiones: `pi.sendMessage({ triggerTurn: true })` despierta a Pi automáticamente cuando llega un mensaje externo, sin necesidad de RPC mode ni spawning externo.

## Goals / Non-Goals

**Goals:**
- Transport confiable entre Claude Code y Pi usando NATS como message broker
- Reactividad automática de Pi al recibir mensajes (sin intervención del usuario)
- Zero assets estáticos en runtime — build TypeScript puro
- Auto-start del servidor NATS si no hay uno corriendo
- CLI de debug para inspeccionar el mesh manualmente

**Non-Goals:**
- Web UI o frontend de ningún tipo
- Persistencia de mensajes entre reinicios (pub/sub puro, sin JetStream por ahora)
- Soporte multi-proyecto simultáneo en esta primera versión
- Publicación en npm (se mantiene privado inicialmente)

## Decisions

### D1: NATS sobre TCP mesh propio

NATS reemplaza el coordinator TCP de `agent-comms`. Alternativas consideradas:
- **TCP mesh propio**: requiere mantener código de networking, reconexión, presencia. Alto costo de mantenimiento.
- **Redis pub/sub**: overhead de infraestructura, requiere Redis corriendo.
- **NATS**: binario único, auto-start trivial, cliente Node.js maduro (`nats` en npm), zero config para uso local.

### D2: Auto-start de NATS vía `nats-server` binary

Al iniciar el MCP server o la extensión Pi, se verifica si hay un servidor NATS en `localhost:4222`. Si no hay respuesta, se lanza `nats-server` como proceso hijo. El binario se descarga automáticamente via `@nats-io/nats-server` o se verifica en PATH.

Alternativa considerada: requerir que el usuario levante NATS manualmente. Rechazada — la DX debe ser zero-config.

### D3: Reactividad de Pi via extensión nativa (no RPC mode)

Pi corre con su UI normal. Una extensión TypeScript cargada por Pi:
1. En `session_start`: conecta a NATS y suscribe a `bridge.{project}.dm.pi` y `bridge.{project}.room.{room}`
2. Al recibir mensaje: llama `pi.sendMessage({ content, customType: "bridge-delivery", display: false }, { triggerTurn: true, deliverAs: "steer" })`

Alternativa considerada: `pi --mode rpc` (bridge controla Pi como proceso hijo). Rechazada — cambia la UX de Pi, el usuario pierde acceso directo al TUI.

### D4: Subjects NATS

```
bridge.{project}.room.{room}      # mensajes a un room
bridge.{project}.dm.{agent-id}    # DMs directos
bridge.{project}.presence         # heartbeats de presencia
bridge.{project}.system           # join, leave, list
```

`{project}` evita colisiones entre proyectos distintos en el mismo servidor NATS local.

### D5: Dos packages independientes

- `bridge-harness`: el MCP server para Claude Code (y el servidor NATS)
- `bridge-harness-pi`: la extensión para Pi

Separados porque sus consumers son distintos (Claude Code vs Pi) y sus ciclos de release pueden divergir.

## Risks / Trade-offs

- **NATS process leak**: si el proceso que levantó NATS muere abruptamente, `nats-server` puede quedar huérfano. Mitigación: registrar `process.on('exit')` para hacer cleanup, y al iniciar verificar si ya hay un server corriendo (no levantarlo de nuevo).
- **Pi extension API inestable**: `pi.sendMessage` con `triggerTurn: true` es API interna de Pi. Si Pi cambia su extensión API, la reactividad se rompe. Mitigación: pinear versión de Pi en el package de la extensión.
- **Sin persistencia**: mensajes enviados cuando Pi no está conectado se pierden. Aceptado como trade-off v1. JetStream puede agregarse después sin cambiar la API pública.
- **Un solo proyecto activo**: el `{project}` en los subjects es hardcoded en la config. Limitación conocida de v1.
