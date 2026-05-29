## ADDED Requirements

### Requirement: Conexión a NATS en session_start
La extensión Pi SHALL conectarse al servidor NATS en `localhost:4222` al inicio de cada sesión de Pi, y suscribirse a los subjects relevantes para el agente Pi.

#### Scenario: Sesión inicia con NATS disponible
- **WHEN** Pi inicia una sesión y hay un servidor NATS en `localhost:4222`
- **THEN** la extensión conecta y suscribe a `bridge.{project}.dm.pi` y `bridge.{project}.room.*`

#### Scenario: Sesión inicia sin NATS disponible
- **WHEN** Pi inicia una sesión y no hay servidor NATS corriendo
- **THEN** la extensión intenta auto-start de NATS antes de continuar, mismo mecanismo que el MCP server

### Requirement: Reactividad automática ante mensajes entrantes
La extensión Pi SHALL disparar un nuevo turn de Pi automáticamente cuando llegue un mensaje via NATS, sin requerir input manual del usuario.

#### Scenario: Mensaje recibido mientras Pi está idle
- **WHEN** llega un mensaje en `bridge.{project}.dm.pi` o en un room suscrito mientras Pi no está procesando
- **THEN** la extensión llama `pi.sendMessage({ content: mensaje, customType: "bridge-delivery", display: false }, { triggerTurn: true, deliverAs: "steer" })` y Pi comienza a procesar automáticamente

#### Scenario: Mensaje recibido mientras Pi está procesando
- **WHEN** llega un mensaje mientras Pi está en medio de un turn activo
- **THEN** la extensión encola el mensaje y lo entrega como `steer` al finalizar el turn actual

### Requirement: Heartbeat de presencia
La extensión Pi SHALL publicar un heartbeat periódico en `bridge.{project}.presence` para que otros agentes puedan detectar que Pi está activo.

#### Scenario: Heartbeat periódico
- **WHEN** la extensión está conectada a NATS
- **THEN** publica `{ agent: "pi", status: "active" }` en `bridge.{project}.presence` cada 30 segundos

#### Scenario: Cleanup en session_shutdown
- **WHEN** Pi cierra la sesión
- **THEN** la extensión publica `{ agent: "pi", status: "offline" }` y cierra la conexión NATS limpiamente

### Requirement: Tool agent_bridge para Pi
La extensión SHALL registrar una tool `agent_bridge` en Pi con acciones `send`, `read`, `list_agents` equivalentes a las del MCP server, para que Pi pueda iniciar comunicación activamente.

#### Scenario: Pi envía mensaje a Claude Code
- **WHEN** Pi llama a la tool `agent_bridge` con `{ action: "send", to: "claude-code", message: "listo" }`
- **THEN** la extensión publica en `bridge.{project}.dm.claude-code` y retorna confirmación
