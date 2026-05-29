import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import {
  NATS_RETRY_INTERVAL_MS,
  NATS_START_TIMEOUT_MS,
} from "../shared/config.js";

let natsProcess: ChildProcess | null = null;

export function checkNatsRunning(port = 4222): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

export function startNatsServer(): ChildProcess {
  const proc = spawn("nats-server", [], {
    stdio: "ignore",
    detached: false,
  });

  proc.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "nats-server not found in PATH. Install it with: brew install nats-server"
      );
    }
    throw err;
  });

  natsProcess = proc;
  return proc;
}

async function waitForNats(
  port = 4222,
  timeoutMs = NATS_START_TIMEOUT_MS,
  retryMs = NATS_RETRY_INTERVAL_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkNatsRunning(port)) return;
    await new Promise((r) => setTimeout(r, retryMs));
  }
  throw new Error(
    `NATS server did not become ready within ${timeoutMs}ms on port ${port}`
  );
}

export async function ensureNats(port = 4222): Promise<void> {
  if (await checkNatsRunning(port)) return;
  startNatsServer();
  await waitForNats(port);
}

function cleanup() {
  if (natsProcess && !natsProcess.killed) {
    natsProcess.kill("SIGTERM");
  }
}

process.on("exit", cleanup);
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
