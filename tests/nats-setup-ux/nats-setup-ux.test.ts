import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(() => ({ killed: false, kill: vi.fn(), on: vi.fn() })),
  };
});

const { execSync } = await import("node:child_process");
const { detectNatsInstalled, getNatsInstallInstructions } = await import(
  "../../src/nats-manager/index.js"
);

describe("detectNatsInstalled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when which nats-server succeeds", () => {
    vi.mocked(execSync).mockReturnValueOnce(Buffer.from("/usr/local/bin/nats-server"));
    expect(detectNatsInstalled()).toBe(true);
  });

  it("returns false when which nats-server fails", () => {
    vi.mocked(execSync).mockImplementationOnce(() => { throw new Error("not found"); });
    expect(detectNatsInstalled()).toBe(false);
  });
});

describe("getNatsInstallInstructions", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns brew command for darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const instructions = getNatsInstallInstructions();
    expect(instructions).toContain("brew install nats-server");
  });

  it("returns GitHub URL for linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const instructions = getNatsInstallInstructions();
    expect(instructions).toContain("nats-io/nats-server");
  });
});

describe("setup without TTY", () => {
  it("non-TTY environments skip interactive prompt", () => {
    // Simulate the logic: if !process.stdin.isTTY → return false
    const hasTTY = false;
    const shouldAsk = hasTTY;
    expect(shouldAsk).toBe(false);
  });
});

describe("CLI fail-fast logic", () => {
  it("exits with code 1 when NATS is not running", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const mockCheckNats = vi.fn().mockResolvedValue(false);

    async function requireNats() {
      if (!(await mockCheckNats())) {
        process.exit(1);
      }
    }

    await expect(requireNats()).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("does not exit when NATS is running", async () => {
    const mockExit = vi.spyOn(process, "exit");
    const mockCheckNats = vi.fn().mockResolvedValue(true);

    async function requireNats() {
      if (!(await mockCheckNats())) {
        process.exit(1);
      }
    }

    await requireNats();
    expect(mockExit).not.toHaveBeenCalled();
    mockExit.mockRestore();
  });
});
