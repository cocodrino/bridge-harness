## ADDED Requirements

### Requirement: Detección de nats-server instalado
El sistema SHALL proveer una función `detectNatsInstalled()` que verifique si el binario `nats-server` está disponible en PATH sin intentar ejecutarlo como servidor.

#### Scenario: nats-server instalado
- **WHEN** `nats-server` está en PATH del sistema
- **THEN** `detectNatsInstalled()` retorna `true`

#### Scenario: nats-server no instalado
- **WHEN** `nats-server` no está en PATH
- **THEN** `detectNatsInstalled()` retorna `false` sin lanzar excepciones

### Requirement: Setup valida nats-server instalado
El comando `bridge-harness-setup` SHALL verificar que `nats-server` esté instalado antes de continuar. Si no está instalado, SHALL mostrar instrucciones de instalación apropiadas para la plataforma y salir con error.

#### Scenario: nats-server no instalado en macOS
- **WHEN** el usuario corre `bridge-harness-setup` en macOS sin `nats-server` en PATH
- **THEN** el setup muestra `brew install nats-server` y sale con exit code 1

#### Scenario: nats-server no instalado en Linux
- **WHEN** el usuario corre `bridge-harness-setup` en Linux sin `nats-server` en PATH
- **THEN** el setup muestra la URL de descarga de releases de GitHub y sale con exit code 1

### Requirement: Setup pregunta si arrancar NATS cuando no está corriendo
El comando `bridge-harness-setup` SHALL preguntar al usuario si quiere arrancar NATS cuando está instalado pero no corriendo, en lugar de arrancarlo silenciosamente.

#### Scenario: NATS instalado pero no corriendo, usuario acepta
- **WHEN** `nats-server` está instalado, no hay servidor en `localhost:4222`, y el usuario responde "y" al prompt
- **THEN** el setup arranca `nats-server`, espera confirmación, y continúa con el resto de la configuración

#### Scenario: NATS instalado pero no corriendo, usuario rechaza
- **WHEN** `nats-server` está instalado, no hay servidor en `localhost:4222`, y el usuario responde "n" al prompt
- **THEN** el setup muestra instrucciones para arrancar NATS manualmente y continúa registrando el MCP y el hook

#### Scenario: Setup sin TTY (entorno no-interactivo)
- **WHEN** el setup corre sin terminal interactiva (`process.stdin.isTTY` es false)
- **THEN** el setup omite el prompt, muestra las instrucciones de arranque y continúa sin intentar arrancar NATS

### Requirement: CLI falla rápido con mensaje descriptivo cuando NATS no está disponible
Los comandos `bridge send`, `bridge read`, y `bridge agents` SHALL verificar que NATS esté corriendo al inicio y fallar con un mensaje claro si no está disponible, sin intentar auto-start.

#### Scenario: CLI ejecutado sin NATS corriendo
- **WHEN** el usuario ejecuta `bridge send` y no hay servidor NATS en `localhost:4222`
- **THEN** el comando imprime un mensaje descriptivo con instrucciones para arrancar NATS y termina con exit code 1

#### Scenario: CLI ejecutado con NATS corriendo
- **WHEN** el usuario ejecuta `bridge send` y NATS está disponible
- **THEN** el comando procede normalmente sin verificación adicional visible
