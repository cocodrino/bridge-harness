import { execFileSync } from "node:child_process";
import { probeSpawnCapability, type SpawnCapability, type SpawnBackend } from "./probe.js";
import { type AgentCommand } from "./command.js";

export interface SpawnResult {
  /** True when we opened a tab/pane programmatically; false means the human must run it. */
  spawned: boolean;
  backend: SpawnBackend;
  detail: string;
  /** Present when spawned=false — the exact command for the human to paste and run. */
  manualCommand?: string;
}

// A runner is injectable so tests never touch a real terminal. It mirrors execFileSync:
// takes an executable + args and returns stdout.
export type Runner = (file: string, args: string[]) => string;

const defaultRunner: Runner = (file, args) =>
  execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

// Open a new tab/pane running `cmd`, using whatever the current terminal supports.
// Always returns a result — on any failure or an unsupported host it degrades to the
// manual command instead of throwing, so the caller can always tell the user what to do.
export function spawnAgentTab(
  cmd: AgentCommand,
  cap: SpawnCapability = probeSpawnCapability(),
  env: NodeJS.ProcessEnv = process.env,
  run: Runner = defaultRunner,
): SpawnResult {
  const manual = (detail: string): SpawnResult => ({
    spawned: false,
    backend: cap.backend,
    detail,
    manualCommand: cmd.shell,
  });

  if (!cap.canSpawnTab) {
    return manual(`${cap.detail} — run this command in a new tab yourself`);
  }

  try {
    switch (cap.backend) {
      case "cmux": {
        const bin = env.CMUX_BUNDLED_CLI_PATH ?? "cmux";
        // Two-step (like tmux send-keys): create the terminal, then type the command.
        const out = run(bin, ["new-pane", "--type", "terminal", "--direction", "down", "--focus", "true"]);
        const ref = /surface:\d+/.exec(out)?.[0];
        if (!ref) return manual(`cmux new-pane returned no surface ref (${out.trim()}) — run it yourself`);
        run(bin, ["send", "--surface", ref, cmd.shell]);
        run(bin, ["send-key", "--surface", ref, "Enter"]);
        return { spawned: true, backend: "cmux", detail: `opened cmux pane ${ref} running "${cmd.label}"` };
      }
      case "tmux": {
        // new-window runs the command via sh -c; one shot, no send-keys needed.
        run("tmux", ["new-window", "-n", cmd.label, cmd.shell]);
        return { spawned: true, backend: "tmux", detail: `opened tmux window "${cmd.label}"` };
      }
      case "zellij": {
        // `zellij run` takes the argv directly after `--`, so no shell quoting is involved.
        run("zellij", ["run", "--name", cmd.label, "--", ...cmd.argv]);
        return { spawned: true, backend: "zellij", detail: `opened zellij pane "${cmd.label}"` };
      }
      default:
        return manual(`${cap.detail} — run this command yourself`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return manual(`could not spawn a tab (${msg}) — run this command yourself`);
  }
}
