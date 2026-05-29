## 1. Script del hook

- [x] 1.1 Crear `hooks/bridge-rewake.js` — script Node.js que conecta a NATS y suscribe a `bridge.{project}.dm.claude-code`
- [x] 1.2 Implementar lectura de `BRIDGE_PROJECT` con fallback a `basename(cwd())`
- [x] 1.3 Implementar handler de mensaje: imprimir system-reminder con contenido y salir con exit code 2
- [x] 1.4 Implementar reconexión con backoff exponencial ante caída de NATS (máx 30s entre intentos)
- [x] 1.5 Hacer el script ejecutable (`chmod +x`) y agregar shebang `#!/usr/bin/env node`

## 2. Registro del hook en Claude Code

- [x] 2.1 Agregar entrada en `~/.claude/settings.json` bajo `hooks.Stop` con `asyncRewake: true` apuntando al script
- [x] 2.2 Configurar `rewakeMessage` con instrucción clara para Claude Code: leer inbox con `read` y responder a Pi si corresponde
- [x] 2.3 Verificar que el JSON resultante es válido y el hook aparece en `/hooks`

## 3. Tests y validación

- [x] 3.1 Unit test: el script imprime el formato correcto de system-reminder al recibir un mensaje mockeado
- [x] 3.2 Unit test: el script usa `BRIDGE_PROJECT` cuando está definida y fallback cuando no
- [ ] 3.3 Test de integración: Pi manda un mensaje → Claude Code se despierta automáticamente → lee inbox → responde a Pi sin intervención del usuario
