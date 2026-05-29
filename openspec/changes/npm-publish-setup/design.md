## Context

El paquete actual funciona pero requiere setup manual. El objetivo es que la experiencia de instalación sea:

```bash
# Claude Code
npm install -g bridge-harness
bridge-harness setup

# Pi
npm install -g bridge-harness-pi
```

Y nada más.

## Goals / Non-Goals

**Goals:**
- `bridge-harness setup` configura MCP + asyncRewake hook automáticamente
- Ambos packages publicables en npm con `npm publish`
- El tarball incluye solo lo necesario (dist compilado, hooks, no fuentes)
- Entry points correctos para que `npx bridge-harness mcp` funcione sin instalar globalmente

**Non-Goals:**
- Publicación automática via CI/CD (manual por ahora)
- Soporte para múltiples versiones simultáneas
- Instalación en Windows (macOS/Linux únicamente en v1)

## Decisions

### D1: Dos packages independientes en npm

- `bridge-harness` — MCP server + CLI + setup + hook
- `bridge-harness-pi` — extensión Pi únicamente

Separados porque sus consumers son distintos y sus versiones pueden divergir. `bridge-harness-pi` es más estable (depende de la API de Pi), `bridge-harness` puede iterar más rápido.

### D2: setup lee y parchea los archivos de configuración de Claude Code

`bridge-harness setup` hace tres cosas:
1. Detecta si `claude` está instalado (`which claude`)
2. Registra el MCP en `~/.claude.json` via `claude mcp add bridge-harness node $(which bridge-harness-mcp)` — o si no existe el CLI de claude, edita el JSON directamente
3. Agrega el hook asyncRewake en `~/.claude/settings.json` mergeando con el contenido existente

El setup es idempotente: si ya está configurado, lo detecta y no duplica entradas.

### D3: bin entries en package.json

```json
"bin": {
  "bridge-harness": "./dist/cli/index.js",
  "bridge-harness-mcp": "./dist/mcp-server/index.js",
  "bridge-harness-setup": "./dist/setup/index.js"
}
```

`bridge-harness` es el CLI de debug. `bridge-harness-mcp` es el que Claude Code invoca. `bridge-harness-setup` es el comando de instalación.

### D4: files en package.json para controlar el tarball

```json
"files": ["dist/", "hooks/", "README.md", "LICENSE"]
```

Excluye `src/`, `tests/`, `openspec/`, `packages/` (el paquete Pi tiene su propio publish).

### D5: engines field para declarar versión mínima de Node

```json
"engines": { "node": ">=18.0.0" }
```

El paquete usa ESM nativo y `await` top-level en algunos módulos.

## Risks / Trade-offs

- **Nombre en npm ocupado**: `bridge-harness` puede estar tomado. Alternativa: publicar como `@usuario/bridge-harness` (scoped). Verificar antes de publicar.
- **Ruta del hook tras instalación global**: el hook `bridge-rewake.js` debe ubicarse en `$(npm root -g)/bridge-harness/hooks/bridge-rewake.js`. El setup lo resuelve dinámicamente con `require.resolve`.
- **Setup idempotente**: si el usuario corre setup dos veces, no debe duplicar el hook. Se detecta leyendo el JSON existente antes de escribir.
