## Why

Actualmente el bridge falla silenciosamente o con errores crípticos cuando NATS no está instalado o no está corriendo. El usuario no sabe qué hacer. La experiencia correcta es: en `setup` (el momento de configuración) preguntar interactivamente y guiar; en los comandos operacionales (CLI) fallar rápido con instrucciones claras; en MCP y Pi (sin TTY) auto-start o error informativo en logs.

## What Changes

- `bridge-harness setup` detecta si `nats-server` está en PATH — si no, muestra instrucciones de instalación por plataforma y sale
- `bridge-harness setup` detecta si NATS está corriendo — si no, pregunta al usuario si quiere arrancarlo ahora
- Los comandos CLI (`bridge send`, `bridge read`, `bridge agents`) fallan rápido con un mensaje claro cuando NATS no está disponible, sin preguntas interactivas
- MCP server y Pi extension mantienen el comportamiento actual (auto-start silencioso), pero el error cuando `nats-server` no está en PATH es más descriptivo
- Nueva función `detectNatsInstalled()` en el nats-manager — detecta si el binario existe en PATH sin intentar spawnearlo

## Capabilities

### New Capabilities

- `nats-setup-validation`: detección de nats-server instalado y corriendo, con UX interactiva en setup y mensajes claros en CLI

### Modified Capabilities

## Impact

- `src/nats-manager/index.ts` — agregar `detectNatsInstalled()`, mejorar mensaje de error ENOENT
- `src/setup/index.ts` — agregar validación interactiva de NATS (instalado + corriendo)
- `src/cli/index.ts` — fallar rápido con mensaje descriptivo si NATS no responde
- Compatible hacia atrás: MCP y Pi extension no cambian su comportamiento
