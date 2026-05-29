## ADDED Requirements

### Requirement: package.json de bridge-harness listo para npm publish
El `package.json` principal SHALL tener todos los campos requeridos para publicación en npm: `name`, `version`, `description`, `bin`, `files`, `engines`, `keywords`, `license`, `repository`.

#### Scenario: npm pack genera tarball correcto
- **WHEN** se ejecuta `npm pack`
- **THEN** el tarball incluye `dist/`, `hooks/`, `README.md`, `LICENSE` y excluye `src/`, `tests/`, `openspec/`, `node_modules/`

#### Scenario: bin entries funcionan post-install
- **WHEN** el paquete está instalado globalmente
- **THEN** los comandos `bridge-harness`, `bridge-harness-mcp` y `bridge-harness-setup` están disponibles en PATH

### Requirement: package.json de bridge-harness-pi listo para npm publish
El `package.json` del paquete Pi SHALL tener los campos correctos para que Pi pueda cargar la extensión desde el directorio de instalación global de npm.

#### Scenario: Pi carga extensión desde npm global
- **WHEN** `bridge-harness-pi` está instalado globalmente
- **THEN** Pi puede cargar la extensión apuntando a `$(npm root -g)/bridge-harness-pi/src/index.ts`

### Requirement: .npmignore excluye archivos innecesarios
Ambos packages SHALL tener `.npmignore` que excluya fuentes TypeScript, tests, openspec, y archivos de desarrollo del tarball publicado.

#### Scenario: Tarball no incluye archivos de desarrollo
- **WHEN** se ejecuta `npm pack` en cualquiera de los dos packages
- **THEN** el tarball no contiene `src/`, `tests/`, `openspec/`, `*.test.ts`, `tsconfig.json`
