## ADDED Requirements

### Requirement: Comando setup auto-configura Claude Code
El comando `bridge-harness setup` SHALL registrar automáticamente el MCP server y el hook asyncRewake en los archivos de configuración de Claude Code, sin requerir edición manual.

#### Scenario: Primera instalación
- **WHEN** el usuario ejecuta `bridge-harness setup` en una máquina sin configuración previa
- **THEN** el MCP `bridge-harness` queda registrado en `~/.claude.json` y el hook asyncRewake en `~/.claude/settings.json`

#### Scenario: Setup idempotente
- **WHEN** el usuario ejecuta `bridge-harness setup` en una máquina ya configurada
- **THEN** el comando detecta la configuración existente y no duplica entradas, reportando "Already configured"

#### Scenario: Claude no está instalado
- **WHEN** el comando `claude` no está en PATH
- **THEN** el setup informa al usuario que debe instalar Claude Code primero y termina con exit code 1

### Requirement: Setup mergeando configuración existente
El comando setup SHALL leer los archivos de configuración existentes antes de escribir, preservando todas las entradas previas (otros MCP servers, otros hooks).

#### Scenario: Hay otros hooks configurados
- **WHEN** `~/.claude/settings.json` ya tiene hooks de otros proyectos
- **THEN** el asyncRewake hook se agrega a la lista existente sin eliminar los demás

### Requirement: Salida clara del comando setup
El comando SHALL imprimir el resultado de cada paso con indicadores visuales de éxito o error.

#### Scenario: Setup exitoso
- **WHEN** el setup completa sin errores
- **THEN** imprime confirmación de cada paso (MCP registrado ✓, hook configurado ✓) y la instrucción de reiniciar Claude Code
