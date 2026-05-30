## ADDED Requirements

### Requirement: MCP server escribe state file al iniciar
El MCP server SHALL escribir `~/.bridge-harness-state.json` al establecer conexión NATS, con los campos `project`, `agentId`, `canonicalSubject` y `startedAt`.

#### Scenario: State file creado al iniciar
- **WHEN** el MCP server conecta a NATS exitosamente
- **THEN** escribe `~/.bridge-harness-state.json` con el project activo y el subject canónico

#### Scenario: State file eliminado al cerrar
- **WHEN** el MCP server recibe señal de cierre (SIGTERM, SIGINT, exit)
- **THEN** elimina `~/.bridge-harness-state.json` antes de cerrar

### Requirement: Hook lee state file para obtener subject
El hook `bridge-rewake.js` SHALL leer `~/.bridge-harness-state.json` al iniciar para determinar el subject NATS correcto, con fallback a la lógica anterior si el archivo no existe.

#### Scenario: State file disponible
- **WHEN** el hook inicia y `~/.bridge-harness-state.json` existe y es válido
- **THEN** suscribe al `canonicalSubject` del state file

#### Scenario: State file no disponible (fallback)
- **WHEN** el hook inicia y el state file no existe o tiene JSON inválido
- **THEN** usa `BRIDGE_PROJECT ?? basename(cwd())` como fallback y construye el subject manualmente
