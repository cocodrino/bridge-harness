## 1. NATS Manager — detección de binario

- [x] 1.1 Implementar `detectNatsInstalled(): boolean` en `src/nats-manager/index.ts` usando `execSync("which nats-server")`
- [x] 1.2 Mejorar el mensaje de error ENOENT en `startNatsServer()` para incluir instrucciones de instalación por plataforma
- [x] 1.3 Exportar `detectNatsInstalled` desde el módulo

## 2. Setup — validación interactiva de NATS

- [x] 2.1 Implementar función helper `ask(question: string): Promise<boolean>` con soporte para entornos sin TTY
- [x] 2.2 Implementar `getNatsInstallInstructions(): string` que retorna instrucciones según `process.platform`
- [x] 2.3 Agregar paso de validación: verificar `detectNatsInstalled()` antes de continuar en setup
- [x] 2.4 Si no instalado: mostrar instrucciones por plataforma y salir con exit code 1
- [x] 2.5 Agregar paso: verificar `checkNatsRunning()` si nats-server está instalado
- [x] 2.6 Si no corriendo con TTY: preguntar "¿Arrancar NATS ahora? [Y/n]"
- [x] 2.7 Si usuario acepta: llamar `startNatsServer()` + `waitForNats()` y confirmar con ✓
- [x] 2.8 Si usuario rechaza o sin TTY: mostrar instrucción manual `nats-server &` y continuar

## 3. CLI — fail fast descriptivo

- [x] 3.1 Agregar verificación de NATS al inicio de cada comando CLI (`send`, `read`, `agents`)
- [x] 3.2 Si NATS no responde: imprimir mensaje descriptivo con instrucción de arranque y salir con exit code 1
- [x] 3.3 Remover cualquier intento de auto-start desde el CLI

## 4. Tests unitarios

- [x] 4.1 Unit test `detectNatsInstalled()`: retorna `true` cuando `which` tiene éxito, `false` cuando falla
- [x] 4.2 Unit test `getNatsInstallInstructions()`: retorna brew para darwin, URL de GitHub para linux
- [x] 4.3 Unit test lógica de setup: sin TTY omite prompt y continúa
- [x] 4.4 Unit test CLI fail-fast: si `checkNatsRunning()` retorna false, el proceso sale con código 1
