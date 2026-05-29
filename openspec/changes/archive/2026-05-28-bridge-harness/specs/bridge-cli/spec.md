## ADDED Requirements

### Requirement: Comando bridge send
El CLI SHALL proveer un comando `bridge send` para publicar mensajes en el mesh desde la terminal, útil para debugging.

#### Scenario: Envío a room desde CLI
- **WHEN** el usuario ejecuta `bridge send --room venflowapp "hola"`
- **THEN** el sistema publica el mensaje en `bridge.{project}.room.venflowapp` y muestra confirmación en stdout

#### Scenario: Envío como DM desde CLI
- **WHEN** el usuario ejecuta `bridge send --to pi "revisá el PR"`
- **THEN** el sistema publica en `bridge.{project}.dm.pi` y muestra confirmación

### Requirement: Comando bridge read
El CLI SHALL proveer un comando `bridge read` para leer mensajes pendientes o suscribirse en modo watch.

#### Scenario: Lectura one-shot
- **WHEN** el usuario ejecuta `bridge read`
- **THEN** el sistema muestra los mensajes pendientes y termina

#### Scenario: Modo watch
- **WHEN** el usuario ejecuta `bridge read --watch`
- **THEN** el sistema queda suscrito e imprime cada mensaje nuevo en tiempo real hasta Ctrl+C

### Requirement: Comando bridge agents
El CLI SHALL proveer un comando `bridge agents` que liste los agentes activos según presencia reciente.

#### Scenario: Listar agentes conectados
- **WHEN** el usuario ejecuta `bridge agents`
- **THEN** el sistema muestra tabla con `agent_id`, `status`, `last_seen` de todos los agentes con heartbeat en los últimos 60 segundos
