## ADDED Requirements

### Requirement: Tool whoami
El MCP server SHALL exponer una tool `whoami` que retorne la identidad completa de Claude Code en el bridge: su agentId, displayName, project, y rooms en los que está suscrito.

#### Scenario: Claude Code conoce su propia identidad
- **WHEN** Claude Code llama `whoami`
- **THEN** retorna `{ agentId: "claude-code-9x2k", displayName: "Claude Code", project: "venflowapp", rooms: ["venflowapp"] }`

### Requirement: Tool who_is_in
El MCP server SHALL exponer una tool `who_is_in` que retorne los agentes actualmente conectados a un room específico.

#### Scenario: Room con agentes conectados
- **WHEN** Claude Code llama `who_is_in` con `{ room: "venflowapp" }`
- **THEN** retorna lista de agentes con `agentId`, `displayName` y `lastSeen` de quienes tienen ese room en su roster

#### Scenario: Room vacío o inexistente
- **WHEN** Claude Code llama `who_is_in` para un room sin agentes
- **THEN** retorna array vacío

### Requirement: list_agents mejorado con identidad completa
La tool `list_agents` existente SHALL incluir `displayName` y `rooms` en cada entrada, además del `lastSeen` ya existente.

#### Scenario: Agente con identidad completa
- **WHEN** Claude Code llama `list_agents` y Pi está conectado con la nueva versión
- **THEN** retorna `[{ agentId: "pi-a3f7", displayName: "Pi Agent", rooms: ["venflowapp"], lastSeen: ... }]`

#### Scenario: Agente legacy sin registro
- **WHEN** Claude Code llama `list_agents` y hay un agente con versión anterior
- **THEN** retorna `[{ agentId: "pi", displayName: "pi", rooms: [], lastSeen: ... }]` — compatible sin romper nada
