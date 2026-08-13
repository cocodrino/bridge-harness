// Builds the exact command line that launches a new agent (pi or claude) with a
// startup prompt telling it to get on the bridge and report back. The SAME command is
// used two ways: fed to a multiplexer to spawn a tab, or printed for the human to run
// when we can't spawn (see spawn.ts). One source of truth, zero duplication.

export type AgentTool = "pi" | "claude";

export interface SpawnRequest {
  /** Which agent CLI to launch. */
  tool: AgentTool;
  /** Memorable handle the new agent claims via set_name (how you'll address it). */
  name: string;
  /** What the new agent should do. */
  task: string;
  /** Who to report back to — the requester's agentId or set_name handle (DM target). */
  requester: string;
  /** Optional human-readable requester name, used only in the prose ("report to Carlos"). */
  requesterDisplay?: string;
}

export interface AgentCommand {
  /** Executable + args, ready for execFile-style spawning (no shell parsing needed). */
  argv: string[];
  /** Same command as a single copy-pasteable shell string (for the manual fallback). */
  shell: string;
  /** The startup prompt embedded in argv — always a single line. */
  prompt: string;
  /** The agent's handle, reused as the tab/window title by the spawner. */
  label: string;
}

// The startup prompt MUST be a single line: it gets typed into a terminal via `send` /
// `send-keys`, and any embedded newline would fire Enter mid-command and run a partial
// line. Steps are numbered inline instead of on separate lines.
export function buildStartupPrompt(req: SpawnRequest): string {
  const reportTo = req.requesterDisplay?.trim()
    ? `${req.requesterDisplay.trim()} (agent:${req.requester})`
    : `agent:${req.requester}`;
  return (
    `You are joining a shared agent bridge as "${req.name}". ` +
    `Get online first: (1) activate bridge comms using the agent-bridge skill / bridge tool; ` +
    `(2) claim your handle by calling set_name "${req.name}"; ` +
    `(3) DM ${reportTo} to confirm you are active — send to="agent:${req.requester}" message="${req.name} online, ready". ` +
    `Then do this task and report progress and the final result back to ${reportTo} over the bridge: ${req.task}`
  );
}

// POSIX single-quote escaping: wrap in '...', and turn each ' into '\'' so the whole
// thing survives being pasted into a shell verbatim.
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildAgentCommand(req: SpawnRequest): AgentCommand {
  const prompt = buildStartupPrompt(req);
  // Both `pi` and `claude` take the prompt as a positional arg and start an INTERACTIVE
  // session by default (no -p), so the spawned agent stays alive to report back.
  const argv = [req.tool, prompt];
  const shell = `${argv[0]} ${argv.slice(1).map(shSingleQuote).join(" ")}`;
  return { argv, shell, prompt, label: req.name };
}
