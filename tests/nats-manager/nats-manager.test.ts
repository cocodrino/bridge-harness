import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:net";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    killed: false,
    kill: vi.fn(),
    on: vi.fn(),
    unref: vi.fn(),
  })),
}));

const { spawn } = await import("node:child_process");

// Re-import after mocks are in place
const {
  checkNatsRunning,
  startNatsServer,
  ensureNats,
  stopNatsServer,
} = await import("../../src/nats-manager/index.js");

describe("checkNatsRunning", () => {
  it("returns true when something is listening on the port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    const port = (server.address() as { port: number }).port;

    const result = await checkNatsRunning(port);
    expect(result).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns false when nothing is listening on the port", async () => {
    // Port 1 is almost certainly closed without root
    const result = await checkNatsRunning(19999);
    expect(result).toBe(false);
  });
});

describe("startNatsServer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("spawns nats-server with JetStream enabled", () => {
    startNatsServer();
    expect(spawn).toHaveBeenCalledWith(
      "nats-server",
      ["-js", "--store_dir", "/tmp/bridge-harness-js"],
      { stdio: "ignore", detached: true }
    );
  });

  // The broker is shared by every agent on the machine. Spawning it attached made the
  // first agent to boot its owner, and that agent killed it on exit — silently
  // disconnecting every other agent at once.
  it("spawns nats-server DETACHED so it outlives the agent that started it", () => {
    startNatsServer();
    const opts = vi.mocked(spawn).mock.calls[0][2] as { detached: boolean };
    expect(opts.detached).toBe(true);
  });

  it("unrefs the child so it never holds this process's event loop open", () => {
    const proc = startNatsServer();
    expect(proc.unref).toHaveBeenCalled();
  });

  it("returns the spawned child process", () => {
    const proc = startNatsServer();
    expect(proc).toBeDefined();
    expect(typeof proc.kill).toBe("function");
  });
});

describe("ensureNats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not spawn if NATS is already running", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    const port = (server.address() as { port: number }).port;

    await ensureNats(port);
    expect(spawn).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("spawns nats-server if NATS is not running", async () => {
    // Use a port that is definitely closed
    const port = 19998;

    // Mock: after spawn is called, pretend NATS starts up
    // We use a real server to simulate it coming up
    const fakeServer = createServer();

    const spawnMock = vi.mocked(spawn);
    spawnMock.mockImplementationOnce(() => {
      // Start a fake server to simulate NATS becoming available
      fakeServer.listen(port, "localhost");
      return { killed: false, kill: vi.fn(), on: vi.fn(), unref: vi.fn() } as never;
    });

    await ensureNats(port);
    expect(spawn).toHaveBeenCalled();

    await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  });
});

// Regression guard for the bug this replaced: nats-server used to be SIGTERM'd from an
// `exit` handler, so whichever agent happened to start the broker took the entire bridge
// down with it when the user closed that one session. Every other agent went deaf at once,
// which read as "disabling the bridge in one agent disabled it in the others".
describe("agent shutdown does NOT touch the shared broker", () => {
  const signals = ["exit", "SIGTERM", "SIGINT"] as const;

  for (const signal of signals) {
    it(`leaves nats-server running on ${signal}`, () => {
      const mockKill = vi.fn();
      const fakeProc = { killed: false, kill: mockKill, on: vi.fn(), unref: vi.fn() };
      vi.mocked(spawn).mockReturnValueOnce(fakeProc as never);

      startNatsServer();
      process.emit(signal as "exit", 0 as never);

      expect(mockKill).not.toHaveBeenCalled();
    });
  }

  it("registers no listener that could kill the broker", () => {
    // If a future change re-adds a killing handler, the assertions above catch it. This
    // one documents that the module intentionally installs no lifecycle hooks at all.
    const fakeProc = { killed: false, kill: vi.fn(), on: vi.fn(), unref: vi.fn() };
    vi.mocked(spawn).mockReturnValueOnce(fakeProc as never);
    startNatsServer();

    process.emit("exit", 0);
    process.emit("SIGTERM" as "exit", 0 as never);
    process.emit("SIGINT" as "exit", 0 as never);

    expect(fakeProc.kill).not.toHaveBeenCalled();
  });
});

describe("stopNatsServer", () => {
  it("kills the broker only when called explicitly", () => {
    const mockKill = vi.fn();
    const fakeProc = { killed: false, kill: mockKill, on: vi.fn(), unref: vi.fn() };
    vi.mocked(spawn).mockReturnValueOnce(fakeProc as never);

    startNatsServer();
    expect(mockKill).not.toHaveBeenCalled();

    stopNatsServer();
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
  });

  it("is a no-op when this process never started a broker", () => {
    expect(() => stopNatsServer()).not.toThrow();
  });
});
