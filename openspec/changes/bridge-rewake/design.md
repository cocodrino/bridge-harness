## Context

El bridge NATS entre Claude Code y Pi funciona correctamente en ambas direcciones. El gap es que Claude Code no puede reaccionar automáticamente a mensajes entrantes — requiere que el usuario llame `read` manualmente.

Claude Code soporta hooks con `asyncRewake: true`: un proceso de fondo que corre indefinidamente y cuando termina con exit code 2, despierta al modelo inyectando su stdout como context. Esto es el mecanismo ideal para reactividad.

## Goals / Non-Goals

**Goals:**
- Claude Code se despierta automáticamente cuando Pi manda un mensaje
- Zero intervención del usuario para el ciclo completo Pi → Claude Code → Pi
- Compatible hacia atrás con el MCP server y la extensión Pi existentes

**Non-Goals:**
- Modificar el MCP server ni la extensión Pi
- Reactividad cuando Claude Code está en medio de un turn activo (el hook espera)
- Soporte para múltiples proyectos simultáneos en v1

## Decisions

### D1: asyncRewake sobre Stop event

El hook se registra en el evento `Stop` (cuando Claude Code termina un turn y queda idle). Con `asyncRewake: true` corre en background indefinidamente. Al recibir un mensaje NATS, sale con exit code 2 — eso despierta a Claude Code y le inyecta el contenido del stdout como system-reminder.

Alternativa considerada: `SessionStart` hook. Rechazada — solo corre una vez al inicio, no permanece activo.

### D2: El hook escucha NATS directamente (no via MCP)

El script de hook se suscribe directamente a `bridge.{project}.dm.claude-code` usando el CLI de NATS (`nats sub`) o un script Node.js mínimo. Cuando llega un mensaje, imprime un system-reminder y sale con exit code 2.

Alternativa: que el hook consulte un endpoint HTTP del MCP server. Rechazada — agrega complejidad innecesaria, NATS ya es el transport.

### D3: Script Node.js en lugar de CLI nats

`nats sub` (CLI) requiere instalación separada. Un script Node.js mínimo usando el mismo cliente `nats` npm del proyecto es más portable y no agrega dependencias nuevas.

### D4: El rewakeMessage guía a Claude Code

El hook imprime un mensaje específico que Claude Code recibe como instrucción:

```
Nuevo mensaje de Pi en el bridge. Llamá la tool `read` para leerlo y respondé a Pi si corresponde.
```

Esto evita que Claude Code interprete el despertar sin contexto.

## Risks / Trade-offs

- **Hook muere si NATS se reinicia**: el script pierde la conexión y no se reconecta solo. Mitigación: agregar lógica de reconexión con backoff en el script.
- **Loop infinito**: si Pi responde a cada mensaje de Claude Code, y Claude Code responde a cada mensaje de Pi, se crea un loop. Mitigación: documentar que Pi debe diseñar sus respuestas para no generar loops; no es responsabilidad del hook.
- **Un solo hook activo**: si Claude Code se reinicia, el hook se registra nuevamente en el próximo `Stop` event. No hay duplicados porque el hook anterior muere con el proceso.
