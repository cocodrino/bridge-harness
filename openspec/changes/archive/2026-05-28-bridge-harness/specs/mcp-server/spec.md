## ADDED Requirements

### Requirement: Tool send
El MCP server SHALL exponer una tool `send` que permita a Claude Code publicar un mensaje en un room o como DM a un agente específico.

#### Scenario: Envío a room
- **WHEN** Claude Code llama `send` con `{ to: "room:venflowapp", message: "hola" }`
- **THEN** el sistema publica en `bridge.{project}.room.venflowapp` y retorna confirmación

#### Scenario: Envío como DM
- **WHEN** Claude Code llama `send` con `{ to: "agent:pi", message: "revisá el PR" }`
- **THEN** el sistema publica en `bridge.{project}.dm.pi` y retorna confirmación

### Requirement: Tool read
El MCP server SHALL exponer una tool `read` que retorne los mensajes pendientes en el inbox de Claude Code desde la última lectura.

#### Scenario: Hay mensajes pendientes
- **WHEN** Claude Code llama `read`
- **THEN** el sistema retorna array de mensajes con `{ from, content, timestamp }` y limpia el inbox

#### Scenario: No hay mensajes
- **WHEN** Claude Code llama `read` y no llegaron mensajes nuevos
- **THEN** el sistema retorna array vacío

### Requirement: Tool list_agents
El MCP server SHALL exponer una tool `list_agents` que retorne los agentes activos en el proyecto según los heartbeats de presencia recientes.

#### Scenario: Pi está conectado
- **WHEN** Claude Code llama `list_agents`
- **THEN** el sistema retorna al menos `[{ id: "pi", lastSeen: <timestamp> }]`

#### Scenario: Nadie más conectado
- **WHEN** Claude Code llama `list_agents` y no hay otros agentes con heartbeat reciente
- **THEN** el sistema retorna array vacío o solo el propio claude-code

### Requirement: Tool join_room
El MCP server SHALL exponer una tool `join_room` que suscriba a Claude Code a un room para recibir sus mensajes.

#### Scenario: Join exitoso
- **WHEN** Claude Code llama `join_room` con `{ room: "venflowapp" }`
- **THEN** el sistema suscribe al subject `bridge.{project}.room.venflowapp` y retorna confirmación

#### Scenario: Ya está en el room
- **WHEN** Claude Code llama `join_room` para un room al que ya está suscrito
- **THEN** el sistema retorna confirmación sin crear suscripción duplicada

### Requirement: Protocolo MCP sobre stdio
El MCP server SHALL correr sobre stdio (no HTTP) para ser compatible con la configuración estándar de Claude Code.

#### Scenario: Inicio del MCP server
- **WHEN** Claude Code lanza `bridge-harness mcp` como MCP server en su config
- **THEN** el proceso corre indefinidamente leyendo/escribiendo JSON-RPC sobre stdin/stdout
