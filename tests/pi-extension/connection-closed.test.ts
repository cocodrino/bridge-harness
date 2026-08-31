import { describe, expect, it, vi } from "vitest";
import { publishIfOpen } from "../../packages/bridge-harness-pi/src/index.js";

const payload = new Uint8Array([1, 2, 3]);

describe("publishIfOpen", () => {
  it("publishes on an open connection", () => {
    const publish = vi.fn();
    const connection = { isClosed: () => false, publish };

    expect(publishIfOpen(connection, "bridge.presence", payload)).toBe(true);
    expect(publish).toHaveBeenCalledWith("bridge.presence", payload);
  });

  it("refuses a connection already known to be closed", () => {
    const publish = vi.fn();
    const connection = { isClosed: () => true, publish };

    expect(publishIfOpen(connection, "bridge.presence", payload)).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("contains CONNECTION_CLOSED when close races publish", () => {
    const connection = {
      isClosed: () => false,
      publish: () => {
        throw Object.assign(new Error("CONNECTION_CLOSED"), { code: "CONNECTION_CLOSED" });
      },
    };

    expect(() => publishIfOpen(connection, "bridge.presence", payload)).not.toThrow();
    expect(publishIfOpen(connection, "bridge.presence", payload)).toBe(false);
  });

  it("preserves unrelated publish errors", () => {
    const error = new Error("serialization failed");
    const connection = {
      isClosed: () => false,
      publish: () => { throw error; },
    };

    expect(() => publishIfOpen(connection, "bridge.presence", payload)).toThrow(error);
  });

  it("refuses a missing connection", () => {
    expect(publishIfOpen(null, "bridge.presence", payload)).toBe(false);
  });
});
