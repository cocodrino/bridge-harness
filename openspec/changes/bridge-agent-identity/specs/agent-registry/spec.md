## ADDED Requirements

### Requirement: ID único por instancia de agente
Cada agente SHALL generar un ID único al inicializarse, combinando su base (`pi`, `claude-code`) con 4 caracteres aleatorios en base36. El ID SHALL ser configurable via variable de entorno `BRIDGE_AGENT_ID` para casos donde se requiere estabilidad entre reinicios.

#### Scenario: ID generado automáticamente
- **WHEN** un agente inicia sin `BRIDGE_AGENT_ID` definida
- **THEN** genera un ID con formato `{base}-{4chars}` (ej: `pi-a3f7`, `claude-code-9x2k`)

#### Scenario: ID forzado via env var
- **WHEN** `BRIDGE_AGENT_ID=my-pi` está definida al iniciar
- **THEN** el agente usa `my-pi` como su ID sin generar uno aleatorio

### Requirement: Registro al conectarse
Todo agente SHALL publicar un evento `join` en `bridge.{project}.registry` inmediatamente al establecer conexión NATS, antes de cualquier otra acción.

#### Scenario: Registro exitoso
- **WHEN** un agente conecta a NATS
- **THEN** publica `{ type: "join", agentId, displayName, timestamp }` en `bridge.{project}.registry`

#### Scenario: Desregistro al desconectarse
- **WHEN** un agente cierra su sesión limpiamente
- **THEN** publica `{ type: "leave", agentId, displayName, timestamp }` antes de cerrar la conexión

### Requirement: Anuncio de room join/leave
Cuando un agente se une o sale de un room, SHALL publicar el evento correspondiente en `bridge.{project}.registry`.

#### Scenario: Anuncio de join a room
- **WHEN** un agente suscribe al subject de un room
- **THEN** publica `{ type: "room-join", agentId, displayName, room, timestamp }`

#### Scenario: Anuncio de leave de room
- **WHEN** un agente cancela su suscripción a un room
- **THEN** publica `{ type: "room-leave", agentId, displayName, room, timestamp }`

### Requirement: displayName configurable
Cada agente SHALL exponer un `displayName` legible, configurable via `BRIDGE_DISPLAY_NAME`. Si no está definida, usa el `agentId` como displayName.

#### Scenario: displayName personalizado
- **WHEN** `BRIDGE_DISPLAY_NAME="Mi Pi Agent"` está definida
- **THEN** todos los eventos de registry incluyen `displayName: "Mi Pi Agent"`
