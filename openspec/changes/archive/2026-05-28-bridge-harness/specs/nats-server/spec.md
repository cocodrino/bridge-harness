## ADDED Requirements

### Requirement: Auto-start del servidor NATS
El sistema SHALL detectar si hay un servidor NATS corriendo en `localhost:4222` al iniciar. Si no hay servidor, SHALL lanzarlo automáticamente como proceso hijo antes de continuar.

#### Scenario: NATS ya está corriendo
- **WHEN** se inicia el MCP server o la extensión Pi y ya hay un proceso escuchando en `localhost:4222`
- **THEN** el sistema conecta al servidor existente sin lanzar uno nuevo

#### Scenario: NATS no está corriendo
- **WHEN** se inicia el MCP server o la extensión Pi y no hay nada en `localhost:4222`
- **THEN** el sistema lanza `nats-server` como proceso hijo y espera hasta confirmar que acepta conexiones antes de continuar

#### Scenario: Cleanup al apagar
- **WHEN** el proceso que inició `nats-server` termina (exit, SIGTERM, SIGINT)
- **THEN** el sistema hace kill del proceso hijo `nats-server` para evitar procesos huérfanos

### Requirement: Health check de conectividad
El sistema SHALL verificar la conectividad con el servidor NATS antes de declararse listo, con reintentos y timeout configurable.

#### Scenario: Servidor responde dentro del timeout
- **WHEN** se lanza `nats-server` y responde en `localhost:4222` dentro de 5 segundos
- **THEN** el sistema establece la conexión y continúa

#### Scenario: Servidor no responde en tiempo
- **WHEN** han pasado 5 segundos y `nats-server` no acepta conexiones
- **THEN** el sistema lanza un error descriptivo indicando que NATS no pudo iniciarse

### Requirement: Cobertura de tests unitarios
Cada función pública del NATS Server Manager (`checkNatsRunning`, `startNatsServer`, `ensureNats`) SHALL tener tests unitarios con dependencias mockeadas (sin levantar un servidor real).

#### Scenario: Tests corren sin infraestructura real
- **WHEN** se ejecuta `npm test`
- **THEN** todos los tests del NATS Server Manager pasan sin requerir un proceso `nats-server` corriendo
