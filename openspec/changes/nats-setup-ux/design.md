## Context

El `nats-manager` actual tiene `ensureNats()` que auto-arranca NATS sin preguntar. Cuando `nats-server` no está en PATH, el error de spawn (`ENOENT`) se lanza en el callback `proc.on("error")`, que puede no propagarse correctamente dependiendo del contexto. El setup actual solo registra el MCP y el hook, pero no valida el entorno NATS.

## Goals / Non-Goals

**Goals:**
- `setup` valida entorno completo: nats-server instalado + corriendo, con prompts interactivos
- CLI falla rápido y descriptivo cuando NATS no está disponible
- Mensaje de instalación por plataforma (brew para macOS, instrucciones alternativas para Linux)

**Non-Goals:**
- Instalar nats-server automáticamente (siempre guía al usuario, nunca instala sin consentimiento)
- Cambiar el comportamiento del MCP server o Pi extension
- Soporte para Windows en v1

## Decisions

### D1: Detección de binario via `which`/`execSync`

```typescript
function detectNatsInstalled(): boolean {
  try {
    execSync("which nats-server", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

Más confiable que intentar spawn y capturar ENOENT. Falla rápido sin efectos secundarios.

### D2: Prompt interactivo en setup via `readline`

Node.js tiene `readline` built-in. No agrega dependencias:

```typescript
import { createInterface } from "node:readline";

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y") || answer === "");
    });
  });
}
```

### D3: Instrucciones de instalación por plataforma

```
macOS:   brew install nats-server
Linux:   curl -L https://github.com/nats-io/nats-server/releases/latest/download/nats-server-linux-amd64.zip | ...
         o: go install github.com/nats-io/nats-server/v2@latest
```

El mensaje detecta `process.platform` y muestra el comando más apropiado.

### D4: CLI falla rápido con exit code 1

Los comandos `bridge send/read/agents` llaman `checkNatsRunning()` al inicio. Si retorna `false`, imprimen mensaje y salen:

```
✗ NATS no está corriendo en localhost:4222
  Arrancalo con: nats-server &
  O configurá BRIDGE_NATS_URL para apuntar a otro servidor.
```

Sin intentar auto-start — eso es responsabilidad de `setup` o del usuario.

### D5: Flujo de setup actualizado

```
bridge-harness-setup
  1. ¿Claude instalado?        → si no: error y salir
  2. ¿nats-server en PATH?     → si no: mostrar instrucciones + salir (no puede continuar)
  3. ¿NATS corriendo?          → si no: "¿Arrancarlo ahora? [Y/n]"
                                    → sí: arranca, espera, confirma
                                    → no: muestra instrucciones manuales y continúa (MCP igual se registra)
  4. Registrar MCP             → ya existente
  5. Configurar hook asyncRewake → ya existente
```

## Risks / Trade-offs

- **readline bloquea en entornos no-interactivos**: si `setup` se corre sin TTY (ej: CI), `readline` puede colgarse. Mitigación: verificar `process.stdin.isTTY` antes de preguntar; si no hay TTY, auto-responder "no" y mostrar instrucciones.
- **`which` no disponible en todos los sistemas**: en Windows no existe. Aceptado — v1 solo soporta macOS/Linux.
