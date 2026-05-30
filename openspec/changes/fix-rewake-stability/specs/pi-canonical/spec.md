## ADDED Requirements

### Requirement: Pi suscribe al nombre canónico además del dinámico
La extensión Pi SHALL suscribir a `bridge.{project}.dm.pi` (canónico) además de `bridge.{project}.dm.pi-{random}` (dinámico), para que cualquier agente pueda alcanzar a Pi con `agent:pi` sin conocer el ID de la instancia actual.

#### Scenario: Pi recibe DM via nombre canónico
- **WHEN** Claude Code envía `send to: "agent:pi" message: "hola"`
- **THEN** Pi recibe el mensaje aunque su ID dinámico sea `pi-a3f7`

#### Scenario: Pi recibe DM via ID dinámico
- **WHEN** Claude Code envía `send to: "agent:pi-a3f7" message: "hola instancia específica"`
- **THEN** Pi recibe el mensaje via su suscripción dinámica

### Requirement: agent_bridge de Pi usa canónico para Claude Code
El tool `agent_bridge` SHALL enviar a `bridge.{project}.dm.claude-code` cuando el destino es `agent:claude-code`, usando el nombre canónico independientemente del ID dinámico activo del MCP server.

#### Scenario: Pi envía a claude-code
- **WHEN** Pi llama `agent_bridge action: "send" to: "agent:claude-code" message: "listo"`
- **THEN** publica en `bridge.{project}.dm.claude-code` (canónico)
- **AND** el MCP server lo recibe via su suscripción al nombre canónico
