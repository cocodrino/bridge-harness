## Context

El hook `bridge-rewake.js` se registra en `~/.claude/settings.json` como asyncRewake y corre en background indefinidamente. Su única función es suscribirse a NATS y despertar a Claude Code cuando llega un mensaje. El problema: no sabe con certeza qué subject escuchar porque usa `BRIDGE_PROJECT ?? basename(cwd())` que puede diferir del project que usa el MCP server en esa sesión.

Del lado de Pi, el ID dinámico crea un problema de descubrimiento: si Pi se reinicia, su ID cambia (`pi-a3f7` → `pi-b9c2`). Claude Code necesita saber el nuevo ID para enviarle DMs. La solución: Pi siempre suscribe a `pi` (canónico) además del dinámico.

## Goals / Non-Goals

**Goals:**
- El hook siempre sabe exactamente qué subject escuchar, independientemente de cwd o env vars
- `agent:pi` siempre funciona como destino, incluso si Pi reinició con nuevo ID dinámico
- `agent:claude-code` siempre funciona como destino para Pi

**Non-Goals:**
- Soporte para múltiples instancias simultáneas del MCP server (una a la vez por máquina)
- Persistencia del state file entre reinicios del sistema

## Decisions

### D1: State file en `~/.bridge-harness-state.json`

```json
{
  "project": "venflowapp",
  "agentId": "claude-code-9x2k",
  "dmSubject": "bridge.venflowapp.dm.claude-code",
  "canonicalSubject": "bridge.venflowapp.dm.claude-code",
  "startedAt": 1234567890
}
```

El hook suscribe a `canonicalSubject` (siempre `claude-code`, no el dinámico). El MCP server suscribe a AMBOS: el dinámico y el canónico.

Escrito en `~/.bridge-harness-state.json` para que esté disponible globalmente, independientemente del cwd.

Limpiado en el cleanup del MCP server (`process.on('exit')`).

### D2: Fallback en el hook si no hay state file

```javascript
const stateFile = join(homedir(), ".bridge-harness-state.json");
let project, canonicalSubject;
try {
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  project = state.project;
  canonicalSubject = state.canonicalSubject;
} catch {
  // Fallback legacy
  project = process.env.BRIDGE_PROJECT ?? basename(process.cwd());
  canonicalSubject = `bridge.${project}.dm.claude-code`;
}
```

### D3: Pi suscribe a nombre canónico `pi` siempre

La extensión Pi suscribe a tres subjects:
1. `bridge.{project}.dm.pi-{random}` (dinámico, instancia específica)
2. `bridge.{project}.dm.pi` (canónico, siempre alcanzable)
3. `bridge.{project}.room.*` (rooms)

Cualquier agente puede enviar a `agent:pi` sin conocer el ID dinámico. El ID dinámico permite dirigirse a una instancia específica cuando hay múltiples.

### D4: `agent_bridge` de Pi usa `claude-code` como canónico

El tool `agent_bridge` de Pi, cuando recibe `to: "agent:claude-code"`, envía a `bridge.{project}.dm.claude-code` — el nombre canónico, no el dinámico de esa sesión.

## Risks / Trade-offs

- **Múltiples instancias del MCP**: si dos instancias del MCP corren simultáneamente, la segunda sobreescribe el state file y el hook apunta a la segunda. Aceptado — caso de uso inusual, documentar como limitación.
- **State file stale**: si el MCP crashea sin limpiar el state file, el hook podría intentar suscribirse a un project que ya no existe. El hook tiene reconexión con backoff, lo resuelve cuando el MCP reinicia.
