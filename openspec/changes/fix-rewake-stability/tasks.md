## 1. MCP Server — state file

- [x] 1.1 Escribir `writeStateFile(project, agentId)` en `src/mcp-server/index.ts` — genera `~/.bridge-harness-state.json` con `{ project, agentId, canonicalSubject, startedAt }`
- [x] 1.2 Llamar `writeStateFile()` justo después de conectar a NATS y publicar el registry join
- [x] 1.3 Agregar `deleteStateFile()` al cleanup de `process.on('exit')`, SIGTERM y SIGINT

## 2. Rewake hook — leer state file

- [x] 2.1 Al inicio del hook, intentar leer `~/.bridge-harness-state.json` con `fs.readFileSync`
- [x] 2.2 Si el archivo existe y es válido JSON: usar `state.canonicalSubject` como subject de suscripción
- [x] 2.3 Si el archivo no existe o falla el parse: fallback a `BRIDGE_PROJECT ?? basename(cwd())` + construir subject manualmente
- [x] 2.4 Loggear en stderr qué subject se usa al arrancar (para facilitar debugging futuro)

## 3. Pi Extension — suscripción canónica

- [x] 3.1 En `subscribeToIncoming()`, agregar suscripción a `sub.dm("pi")` (canónico) además del dinámico `sub.dm(agentId)`
- [x] 3.2 Publicar registry `room-join` con ambos IDs (canónico y dinámico) para visibilidad

## 4. Tests

- [x] 4.1 Unit test: `writeStateFile` genera JSON correcto con todos los campos
- [x] 4.2 Unit test: hook con state file válido usa el `canonicalSubject` del archivo
- [x] 4.3 Unit test: hook sin state file usa el fallback de cwd
- [x] 4.4 Unit test: Pi recibe mensajes tanto en `dm.pi` como en `dm.pi-{random}`
