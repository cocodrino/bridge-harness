## ADDED Requirements

### Requirement: Script de hook que monitorea mensajes entrantes
El sistema SHALL proveer un script Node.js (`hooks/bridge-rewake.js`) que se conecte a NATS, suscriba a `bridge.{project}.dm.claude-code`, y cuando reciba un mensaje imprima un system-reminder y salga con exit code 2 para despertar a Claude Code.

#### Scenario: Mensaje recibido mientras Claude Code está idle
- **WHEN** Pi publica un mensaje en `bridge.{project}.dm.claude-code`
- **THEN** el script imprime el system-reminder con el contenido del mensaje y sale con exit code 2

#### Scenario: Reconexión ante caída de NATS
- **WHEN** la conexión NATS se interrumpe
- **THEN** el script intenta reconectarse con backoff exponencial (máx 30s entre intentos) en lugar de terminar

#### Scenario: Variable de entorno BRIDGE_PROJECT
- **WHEN** el script inicia con `BRIDGE_PROJECT=venflowapp` en el entorno
- **THEN** suscribe a `bridge.venflowapp.dm.claude-code`

#### Scenario: Fallback al nombre del directorio
- **WHEN** `BRIDGE_PROJECT` no está definida
- **THEN** usa el basename del directorio de trabajo como nombre del proyecto

### Requirement: Registro del hook en Claude Code settings
El sistema SHALL registrar el script como hook `asyncRewake` en el evento `Stop` de Claude Code, con un `rewakeMessage` que instruya al modelo a leer el inbox y responder a Pi.

#### Scenario: Hook registrado correctamente
- **WHEN** se revisa `~/.claude/settings.json`
- **THEN** existe una entrada en `hooks.Stop` con `type: "command"`, `asyncRewake: true`, y `command` apuntando al script

#### Scenario: Claude Code se despierta con contexto
- **WHEN** el hook sale con exit code 2
- **THEN** Claude Code recibe el `rewakeMessage` como instrucción y el stdout del hook como contexto adicional

### Requirement: Compatibilidad con el MCP server existente
El hook SHALL ser compatible con el MCP server `bridge-harness` ya instalado — no requiere cambios en el MCP server ni en la extensión Pi.

#### Scenario: Claude Code usa tool read tras despertar
- **WHEN** Claude Code se despierta por el hook
- **THEN** puede llamar la tool `read` del MCP `bridge-harness` para leer el mensaje y `send` para responder a Pi
