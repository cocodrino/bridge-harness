import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:net";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    killed: false,
    kill: vi.fn(),
    on: vi.fn(),
  })),
}));

const { spawn } = await import("node:child_process");

// Re-import after mocks are in place
const {
  checkNatsRunning,
  startNatsServer,
  ensureNats,
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

  it("spawns nats-server with correct args", () => {
    startNatsServer();
    expect(spawn).toHaveBeenCalledWith("nats-server", [], {
      stdio: "ignore",
      detached: false,
    });
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
      return { killed: false, kill: vi.fn(), on: vi.fn() } as never;
    });

    await ensureNats(port);
    expect(spawn).toHaveBeenCalled();

    await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  });
});

describe("cleanup on process signals", () => {
  it("kills nats process when process exits", () => {
    const mockKill = vi.fn();
    const fakeProc = { killed: false, kill: mockKill, on: vi.fn() };
    vi.mocked(spawn).mockReturnValueOnce(fakeProc as never);

    startNatsServer();

    // Trigger the exit handler
    process.emit("exit", 0);

    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
  });
});
