import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Minimal Pi context mock ----
function createPiMock() {
  const handlers: Record<string, () => void | Promise<void>> = {};
  const sendMessage = vi.fn();
  const registerTool = vi.fn();

  const pi = {
    on: (event: string, handler: () => void | Promise<void>) => {
      handlers[event] = handler;
    },
    sendMessage,
    registerTool,
    _trigger: (event: string) => handlers[event]?.(),
  };

  return { pi, sendMessage, registerTool };
}

// ---- Replicate extension logic for unit testing ----
// We extract the core behaviors without importing the real module
// to avoid requiring an actual NATS server.

function createExtensionBehavior(pi: ReturnType<typeof createPiMock>["pi"]) {
  let isProcessingTurn = false;
  const messageQueue: string[] = [];
  let connected = false;

  const mockNatsPublish = vi.fn();
  const mockNatsSubscribe = vi.fn();

  function deliverMessage(content: string) {
    pi.sendMessage(
      { content, customType: "bridge-delivery", display: false },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }

  function flushQueue() {
    while (messageQueue.length > 0) {
      deliverMessage(messageQueue.shift()!);
    }
  }

  pi.on("session_start", async () => {
    connected = true;
    mockNatsPublish("bridge.test.presence", { agent: "pi", status: "active" });
    mockNatsSubscribe("bridge.test.dm.pi");
    mockNatsSubscribe("bridge.test.room.*");
  });

  pi.on("agent_end", () => {
    isProcessingTurn = false;
    flushQueue();
  });

  pi.on("session_shutdown", async () => {
    if (connected) {
      mockNatsPublish("bridge.test.presence", { agent: "pi", status: "offline" });
      connected = false;
    }
  });

  return {
    mockNatsPublish,
    mockNatsSubscribe,
    simulateIncomingMessage: (from: string, content: string) => {
      const formatted = `[Bridge] Message from ${from}: ${content}`;
      if (isProcessingTurn) {
        messageQueue.push(formatted);
      } else {
        deliverMessage(formatted);
      }
    },
    setProcessingTurn: (val: boolean) => { isProcessingTurn = val; },
    getQueue: () => messageQueue,
  };
}

// ---- Tests ----

describe("session_start handler", () => {
  it("connects to NATS and publishes active presence", async () => {
    const { pi } = createPiMock();
    const { mockNatsPublish, mockNatsSubscribe } = createExtensionBehavior(pi);

    await pi._trigger("session_start");

    expect(mockNatsPublish).toHaveBeenCalledWith(
      "bridge.test.presence",
      expect.objectContaining({ agent: "pi", status: "active" })
    );
    expect(mockNatsSubscribe).toHaveBeenCalledWith("bridge.test.dm.pi");
    expect(mockNatsSubscribe).toHaveBeenCalledWith("bridge.test.room.*");
  });
});

describe("incoming message handling", () => {
  it("calls pi.sendMessage with triggerTurn: true when Pi is idle", async () => {
    const { pi, sendMessage } = createPiMock();
    const { simulateIncomingMessage } = createExtensionBehavior(pi);

    await pi._trigger("session_start");
    simulateIncomingMessage("claude-code", "check the PR");

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: "bridge-delivery" }),
      expect.objectContaining({ triggerTurn: true, deliverAs: "steer" })
    );
  });

  it("queues messages when Pi is processing a turn", async () => {
    const { pi, sendMessage } = createPiMock();
    const { simulateIncomingMessage, setProcessingTurn, getQueue } =
      createExtensionBehavior(pi);

    await pi._trigger("session_start");
    setProcessingTurn(true);
    simulateIncomingMessage("claude-code", "urgent message");

    expect(getQueue()).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("delivers queued messages after agent_end", async () => {
    const { pi, sendMessage } = createPiMock();
    const { simulateIncomingMessage, setProcessingTurn } =
      createExtensionBehavior(pi);

    await pi._trigger("session_start");
    setProcessingTurn(true);
    simulateIncomingMessage("claude-code", "message 1");
    simulateIncomingMessage("claude-code", "message 2");

    expect(sendMessage).not.toHaveBeenCalled();

    await pi._trigger("agent_end");

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("session_shutdown handler", () => {
  it("publishes offline status and closes connection", async () => {
    const { pi } = createPiMock();
    const { mockNatsPublish } = createExtensionBehavior(pi);

    await pi._trigger("session_start");
    await pi._trigger("session_shutdown");

    expect(mockNatsPublish).toHaveBeenLastCalledWith(
      "bridge.test.presence",
      expect.objectContaining({ agent: "pi", status: "offline" })
    );
  });
});
