## ADDED Requirements

### Requirement: Registro de identidad al iniciar sesión
La extensión Pi SHALL generar un ID único, publicar su registro en `bridge.{project}.registry`, y mantener un roster local de agentes conectados.

#### Scenario: Pi se registra al conectar
- **WHEN** Pi inicia una sesión y conecta a NATS
- **THEN** publica `{ type: "join", agentId: "pi-a3f7", displayName: "Pi Agent", timestamp }` en registry antes de procesar mensajes

#### Scenario: Pi actualiza su roster al recibir registros de otros
- **WHEN** otro agente publica un evento `join` en registry
- **THEN** la extensión agrega ese agente al roster local con su `displayName` y `rooms`

#### Scenario: Pi elimina agentes del roster al recibir leave
- **WHEN** otro agente publica un evento `leave` en registry
- **THEN** la extensión elimina ese agente del roster local

### Requirement: Room awareness en la extensión Pi
La extensión Pi SHALL rastrear qué rooms están activos y anunciar sus join/leave via registry.

#### Scenario: Pi anuncia join a room
- **WHEN** la extensión suscribe a un room vía el subject wildcard
- **THEN** publica `{ type: "room-join", agentId, displayName, room: "*", timestamp }` indicando que Pi está suscrito a todos los rooms del proyecto

#### Scenario: Pi conoce los rooms de otros agentes
- **WHEN** otro agente publica `room-join` o `room-leave`
- **THEN** la extensión actualiza el roster local reflejando los rooms de ese agente

### Requirement: tool agent_bridge actualizada con identidad
La tool `agent_bridge` SHALL usar el `agentId` dinámico (no hardcodeado) como campo `from` en los mensajes que envía.

#### Scenario: Mensaje enviado con ID correcto
- **WHEN** Pi usa `agent_bridge` con `action: "send"`
- **THEN** el payload incluye `from: "pi-a3f7"` (el ID único de esta instancia, no el hardcodeado "pi")
