## Why

Actualmente instalar bridge-harness requiere clonar el repo, buildear manualmente, y configurar el MCP y el hook a mano editando archivos JSON. Para que cualquier desarrollador pueda usarlo en minutos, necesitamos publicarlo en npm con un comando de setup que automatice toda la configuración.

## What Changes

- Publicar `bridge-harness` en npm con un comando CLI `bridge-harness setup` que auto-configura Claude Code (MCP + asyncRewake hook)
- Publicar `bridge-harness-pi` en npm como paquete separado para la extensión de Pi
- Agregar comando `bridge-harness mcp` como entry point del MCP server (para que Claude Code lo invoque via `npx`)
- Agregar script `bridge-harness setup` que registra el MCP en `~/.claude.json` y el hook asyncRewake en `~/.claude/settings.json`
- Configurar `package.json` con los campos correctos para npm: `main`, `bin`, `files`, `engines`, `publishConfig`
- Agregar `.npmignore` para excluir archivos innecesarios del tarball
- Documentar el flujo de instalación en README

## Capabilities

### New Capabilities

- `setup-cli`: Comando `bridge-harness setup` que auto-configura Claude Code y el hook asyncRewake
- `npm-package-config`: Configuración de ambos packages para publicación en npm con los campos correctos

### Modified Capabilities

## Impact

- Modifica `package.json` de ambos packages (`bridge-harness` y `bridge-harness-pi`)
- Agrega `src/setup/index.ts` — lógica del comando setup
- Agrega `.npmignore` en ambos packages
- Actualiza README con instrucciones de instalación via npm
- No modifica el MCP server ni la extensión Pi — son compatibles hacia atrás
