import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { mkdirSync } from "node:fs";
import {
  NATS_RETRY_INTERVAL_MS,
  NATS_START_TIMEOUT_MS,
} from "../shared/config.js";

// JetStream is enabled so DMs can be retained/redelivered (see shared/jetstream.ts).
// Ephemeral store under /tmp: 30-min retention, and agents die on reboot anyway.
export const JETSTREAM_STORE_DIR = "/tmp/bridge-harness-js";

export function detectNatsInstalled(): boolean {
  try {
    execSync("which nats-server", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getNatsInstallInstructions(): string {
  if (process.platform === "darwin") {
    return "brew install nats-server";
  }
  return [
    "# Option 1 (Go):",
    "  go install github.com/nats-io/nats-server/v2@latest",
    "# Option 2 (direct download):",
    "  https://github.com/nats-io/nats-server/releases/latest",
  ].join("\n");
}

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

// NATS is a SHARED resource: every agent on the machine talks to the same broker.
// It is therefore spawned detached + unref'd, so it outlives whichever agent happened
// to start it. Previously it ran as an attached child that we SIGTERM'd on exit, which
// meant the first agent to boot owned the broker and took the whole bridge down with it
// when it quit — every other agent went silent at once.
export function startNatsServer(): ChildProcess {
  try { mkdirSync(JETSTREAM_STORE_DIR, { recursive: true }); } catch {}
  const proc = spawn("nats-server", ["-js", "--store_dir", JETSTREAM_STORE_DIR], {
    stdio: "ignore",
    detached: true,
  });
  // Don't hold the event loop open on the broker's behalf.
  proc.unref();

  proc.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `nats-server not found in PATH.\n\nInstall it with:\n  ${getNatsInstallInstructions()}`
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

// NOTE: there is deliberately NO exit/SIGTERM/SIGINT handler that kills nats-server.
// The broker is shared by every agent on the machine, so tearing it down when one agent
// exits would disconnect all the others. A leftover nats-server is cheap (~10 MB idle)
// and is reused by the next agent via ensureNats()'s early return.
//
// Exposed for tests and for an explicit operator-initiated shutdown only — never wired
// to this process's lifecycle.
export function stopNatsServer(): void {
  if (natsProcess && !natsProcess.killed) {
    natsProcess.kill("SIGTERM");
  }
  natsProcess = null;
}
