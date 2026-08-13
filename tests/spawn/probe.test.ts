import { describe, it, expect } from "vitest";
import { probeSpawnCapability } from "../../src/spawn/probe.js";

// env is injected explicitly so the suite is hermetic — it must not depend on whatever
// terminal actually runs the tests (which, on this machine, is cmux-on-ghostty).
describe("probeSpawnCapability", () => {
  it("detects cmux even when TERM_PROGRAM=ghostty is also present (pane-controller wins)", () => {
    const cap = probeSpawnCapability({ CMUX_SOCKET_PATH: "/x.sock", TERM_PROGRAM: "ghostty" });
    expect(cap.backend).toBe("cmux");
    expect(cap.canSpawnTab).toBe(true);
    expect(cap.method).toBe("cmux-cli");
  });

  it("prefers the bundled cmux CLI path when provided", () => {
    const cap = probeSpawnCapability({ CMUX_SOCKET_PATH: "/x.sock", CMUX_BUNDLED_CLI_PATH: "/apps/cmux" });
    expect(cap.detail).toContain("/apps/cmux");
  });

  it("respects precedence: cmux beats tmux and zellij when several are set", () => {
    const cap = probeSpawnCapability({ CMUX_SOCKET_PATH: "/x.sock", TMUX: "/tmp/tmux", ZELLIJ: "0" });
    expect(cap.backend).toBe("cmux");
  });

  it("detects tmux", () => {
    const cap = probeSpawnCapability({ TMUX: "/tmp/tmux-501/default,123,0" });
    expect(cap.backend).toBe("tmux");
    expect(cap.canSpawnTab).toBe(true);
    expect(cap.method).toBe("tmux-cli");
  });

  it("detects zellij", () => {
    const cap = probeSpawnCapability({ ZELLIJ: "0" });
    expect(cap.backend).toBe("zellij");
    expect(cap.canSpawnTab).toBe(true);
    expect(cap.method).toBe("zellij-cli");
  });

  it("falls back to manual for a pure emulator (ghostty standalone)", () => {
    const cap = probeSpawnCapability({ TERM_PROGRAM: "ghostty" });
    expect(cap.backend).toBe("emulator");
    expect(cap.canSpawnTab).toBe(false);
    expect(cap.method).toBe("manual");
    expect(cap.detail).toContain("ghostty");
  });

  it("never returns an empty detail", () => {
    const cases: NodeJS.ProcessEnv[] = [
      { CMUX_SOCKET_PATH: "/x" },
      { TMUX: "/x" },
      { ZELLIJ: "0" },
      {},
    ];
    for (const env of cases) expect(probeSpawnCapability(env).detail.length).toBeGreaterThan(0);
  });
});
