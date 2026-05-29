## 1. Verificar disponibilidad del nombre en npm

- [x] 1.1 Verificar si `bridge-harness` está disponible en npm (`npm view bridge-harness`)
- [x] 1.2 Verificar si `bridge-harness-pi` está disponible en npm
- [x] 1.3 Si alguno está tomado, decidir nombre scoped (`@usuario/bridge-harness`) y actualizar todos los archivos

## 2. Configurar package.json principal (bridge-harness)

- [x] 2.1 Agregar campos `description`, `keywords`, `license`, `repository`, `homepage`, `author`
- [x] 2.2 Actualizar `bin` con tres entry points: `bridge-harness` (CLI), `bridge-harness-mcp` (MCP server), `bridge-harness-setup` (setup)
- [x] 2.3 Agregar campo `files` con `["dist/", "hooks/", "README.md", "LICENSE"]`
- [x] 2.4 Agregar campo `engines` con `{ "node": ">=18.0.0" }`
- [x] 2.5 Agregar campo `publishConfig` con `{ "access": "public" }`

## 3. Agregar archivo LICENSE

- [x] 3.1 Crear `LICENSE` con texto MIT y nombre del autor

## 4. Implementar comando setup (src/setup/index.ts)

- [x] 4.1 Crear `src/setup/index.ts` — entry point del comando setup
- [x] 4.2 Implementar detección de Claude Code en PATH (`which claude`)
- [x] 4.3 Implementar registro del MCP via `claude mcp add` (o edición directa de `~/.claude.json` si el CLI falla)
- [x] 4.4 Implementar merge del hook asyncRewake en `~/.claude/settings.json` preservando hooks existentes
- [x] 4.5 Implementar detección de configuración existente (idempotencia)
- [x] 4.6 Implementar salida visual con checkmarks por cada paso

## 5. Agregar .npmignore

- [x] 5.1 Crear `.npmignore` en el root del proyecto
- [x] 5.2 Crear `.npmignore` en `packages/bridge-harness-pi/`

## 6. Configurar package.json de bridge-harness-pi

- [x] 6.1 Agregar campos `description`, `keywords`, `license`, `repository`, `author`
- [x] 6.2 Agregar campo `files` con `["src/", "README.md", "LICENSE"]`
- [x] 6.3 Agregar campo `engines` con `{ "node": ">=18.0.0" }`
- [x] 6.4 Agregar campo `publishConfig` con `{ "access": "public" }`
- [x] 6.5 Crear `LICENSE` en `packages/bridge-harness-pi/`

## 7. Actualizar tsconfig.json para incluir setup en el build

- [x] 7.1 Verificar que `src/setup/index.ts` queda incluido en el build de `tsc`

## 8. Actualizar README con instrucciones de instalación via npm

- [x] 8.1 Reemplazar sección de instalación con flujo npm: `npm install -g bridge-harness && bridge-harness setup`
- [x] 8.2 Agregar sección de instalación de `bridge-harness-pi` para Pi

## 9. Validación

- [x] 9.1 Ejecutar `npm pack` y verificar contenido del tarball
- [x] 9.2 Ejecutar `bridge-harness setup` en modo dry-run o test y verificar output
- [x] 9.3 Verificar que `npm publish --dry-run` no reporta errores
