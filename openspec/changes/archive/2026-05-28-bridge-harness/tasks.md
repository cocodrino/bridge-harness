## 1. Setup del proyecto

- [x] 1.1 Inicializar repositorio con `package.json`, `tsconfig.json`, estructura de carpetas (`src/`, `packages/`)
- [x] 1.2 Agregar dependencias: `nats`, `@modelcontextprotocol/sdk`, `nats-server` (o wrapper del binario)
- [x] 1.3 Configurar build con `tsc` puro — sin Vite, sin bundler adicional
- [x] 1.4 Configurar dos entry points en `package.json`: `bin.bridge-harness` y exports del package Pi

## 2. NATS Server Manager

- [x] 2.1 Implementar `checkNatsRunning()` — intenta conectar a `localhost:4222`, retorna boolean
- [x] 2.2 Implementar `startNatsServer()` — lanza `nats-server` como proceso hijo con spawn
- [x] 2.3 Implementar health check con reintentos (máx 5s, intervalos de 200ms)
- [x] 2.4 Registrar cleanup en `process.on('exit')`, `SIGTERM`, `SIGINT` para matar el proceso hijo
- [x] 2.5 Exportar `ensureNats()` — función única que orquesta check + start si necesario

## 3. MCP Server (Claude Code)

- [x] 3.1 Crear servidor MCP base usando `@modelcontextprotocol/sdk` sobre stdio
- [x] 3.2 Implementar tool `join_room` — suscribe al subject `bridge.{project}.room.{room}`
- [x] 3.3 Implementar tool `send` — publica en `bridge.{project}.room.{room}` o `bridge.{project}.dm.{agent}`
- [x] 3.4 Implementar tool `read` — retorna mensajes del inbox interno y lo limpia
- [x] 3.5 Implementar tool `list_agents` — lee presencia del cache y retorna agentes activos (últimos 60s)
- [x] 3.6 Suscribir a `bridge.{project}.presence` para mantener cache de agentes activos
- [x] 3.7 Integrar `ensureNats()` al inicio del MCP server antes de exponer tools

## 4. Pi Extension

- [x] 4.1 Inicializar package separado `bridge-harness-pi` con estructura de extensión Pi válida
- [x] 4.2 Implementar handler `session_start` — llama `ensureNats()` y conecta cliente NATS
- [x] 4.3 Suscribir a `bridge.{project}.dm.pi` y `bridge.{project}.room.*` al conectar
- [x] 4.4 Implementar callback de mensaje entrante — llama `pi.sendMessage({ triggerTurn: true, deliverAs: "steer" })`
- [x] 4.5 Implementar cola de mensajes para el caso donde Pi está procesando un turn activo
- [x] 4.6 Implementar heartbeat — publica en `bridge.{project}.presence` cada 30 segundos
- [x] 4.7 Implementar handler `session_shutdown` — publica status offline y cierra conexión NATS
- [x] 4.8 Registrar tool `agent_bridge` en Pi con acciones `send`, `read`, `list_agents`

## 5. Bridge CLI

- [x] 5.1 Implementar comando `bridge send --room <room> <msg>` y `bridge send --to <agent> <msg>`
- [x] 5.2 Implementar comando `bridge read` (one-shot) y `bridge read --watch` (streaming)
- [x] 5.3 Implementar comando `bridge agents` — tabla de agentes con last_seen

## 6. Subjects y configuración

- [x] 6.1 Definir constantes de subjects NATS en módulo compartido (`bridge.{project}.room.*`, `dm.*`, `presence`, `system`)
- [x] 6.2 Implementar lectura de `{project}` desde variable de entorno `BRIDGE_PROJECT` con fallback a nombre del directorio actual

## 7. Setup de testing

- [x] 7.1 Agregar `vitest` como test runner y configurar `vitest.config.ts`
- [x] 7.2 Configurar script `test` en `package.json` y `test:watch` para desarrollo

## 8. Tests unitarios — NATS Server Manager

- [x] 8.1 Unit test `checkNatsRunning()`: retorna `true` cuando hay servidor en el puerto, `false` cuando no hay nada (mockear conexión TCP)
- [x] 8.2 Unit test `startNatsServer()`: verifica que se llama `spawn` con los argumentos correctos
- [x] 8.3 Unit test `ensureNats()`: no llama `startNatsServer()` si `checkNatsRunning()` retorna `true`
- [x] 8.4 Unit test `ensureNats()`: llama `startNatsServer()` y espera health check si `checkNatsRunning()` retorna `false`
- [x] 8.5 Unit test cleanup: verifica que `SIGTERM`/`SIGINT` mata el proceso hijo

## 9. Tests unitarios — MCP Server tools

- [x] 9.1 Unit test tool `send`: verifica que publica en el subject correcto según destino (room vs DM)
- [x] 9.2 Unit test tool `read`: retorna mensajes acumulados y limpia el inbox después de leer
- [x] 9.3 Unit test tool `read`: retorna array vacío si no hay mensajes pendientes
- [x] 9.4 Unit test tool `list_agents`: retorna solo agentes con heartbeat en los últimos 60s
- [x] 9.5 Unit test tool `list_agents`: excluye agentes con heartbeat vencido
- [x] 9.6 Unit test tool `join_room`: suscribe al subject correcto y no duplica suscripciones

## 10. Tests unitarios — Pi Extension

- [x] 10.1 Unit test handler `session_start`: llama `ensureNats()` y establece conexión NATS
- [x] 10.2 Unit test mensaje entrante: llama `pi.sendMessage` con `triggerTurn: true` al recibir DM
- [x] 10.3 Unit test cola de mensajes: encola mensajes cuando Pi está procesando un turn activo y los entrega al terminar
- [x] 10.4 Unit test heartbeat: publica en `bridge.{project}.presence` cada 30s
- [x] 10.5 Unit test `session_shutdown`: publica status offline y cierra conexión NATS

## 11. Tests de integración y validación manual

- [ ] 11.1 Test de integración: MCP server envía mensaje → Pi extension lo recibe y dispara turn
- [ ] 11.2 Test de integración: Pi envía mensaje → Claude Code lo lee via tool `read`
- [ ] 11.3 Test de integración: auto-start de NATS cuando no está corriendo
- [ ] 11.4 Test de integración: cleanup de proceso NATS al terminar el proceso padre
- [ ] 11.5 Test manual de CLI completo (`bridge send`, `bridge read --watch`, `bridge agents`)
