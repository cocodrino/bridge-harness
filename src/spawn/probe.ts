import { fileURLToPath } from "node:url";

// Where a new agent tab/pane can be opened, and whether WE can do it programmatically.
// This is a CAPABILITY probe, not an identity probe: knowing "we are in ghostty" is
// useless — the caller needs to know "can I spawn a tab here, and how".
export type SpawnBackend = "cmux" | "tmux" | "zellij" | "emulator";

export type SpawnMethod = "cmux-cli" | "tmux-cli" | "zellij-cli" | "manual";

export interface SpawnCapability {
  backend: SpawnBackend;
  /** True only when we can open a tab/pane without human intervention. */
  canSpawnTab: boolean;
  /** Strategy id the spawner dispatches on. "manual" = print the command for the human. */
  method: SpawnMethod;
  /** Human-readable explanation — always populated, including on the manual fallback. */
  detail: string;
}

// Detection MUST go pane-controller -> emulator (specific -> generic), never the reverse.
// Critical case: cmux is layered ON TOP of ghostty, so the same env exposes BOTH
// TERM_PROGRAM=ghostty AND CMUX_SOCKET_PATH. Checking the emulator first would wrongly
// report "cannot spawn a tab" while the cmux CLI+socket are right there.
export function probeSpawnCapability(env: NodeJS.ProcessEnv = process.env): SpawnCapability {
  // 1. cmux — pane controller with a CLI + control socket (see getCmuxSurfaceName in
  //    shared/config.ts, which already drives the same binary).
  if (env.CMUX_SOCKET_PATH) {
    const bin = env.CMUX_BUNDLED_CLI_PATH ?? "cmux";
    return {
      backend: "cmux",
      canSpawnTab: true,
      method: "cmux-cli",
      detail: `cmux via ${bin} (socket ${env.CMUX_SOCKET_PATH})`,
    };
  }

  // 2. tmux — $TMUX is the control socket path when inside a session.
  if (env.TMUX) {
    return {
      backend: "tmux",
      canSpawnTab: true,
      method: "tmux-cli",
      detail: "tmux via `new-window` + `send-keys`",
    };
  }

  // 3. zellij — $ZELLIJ is set to "0" inside a session.
  if (env.ZELLIJ) {
    return {
      backend: "zellij",
      canSpawnTab: true,
      method: "zellij-cli",
      detail: "zellij via `zellij action new-pane`",
    };
  }

  // 4. Pure emulator (standalone ghostty, iTerm, Terminal.app, ...) — no programmatic
  //    pane API. Degrade gracefully: the caller prints the full command for the human.
  const emu = env.TERM_PROGRAM ?? env.TERM ?? "unknown";
  return {
    backend: "emulator",
    canSpawnTab: false,
    method: "manual",
    detail: `no pane controller detected (emulator: ${emu}) — cannot open a tab programmatically`,
  };
}

// `node <abs-path>/probe.ts` prints the capability as JSON, so it can be run standalone
// to see what the current terminal reports.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(JSON.stringify(probeSpawnCapability(), null, 2) + "\n");
}
