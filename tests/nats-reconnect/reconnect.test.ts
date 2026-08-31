import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NATS_CONNECT_OPTIONS, NATS_URL } from "../../src/shared/config.js";

// nats.js defaults to maxReconnectAttempts: 10. With a 2s wait that is ~20 seconds before
// the client closes the connection permanently. An agent session lasts hours, so a broker
// restart used to leave it deaf forever even after NATS came back — no error surfaced,
// the agent simply stopped receiving anything.
describe("NATS_CONNECT_OPTIONS", () => {
  it("never gives up reconnecting", () => {
    expect(NATS_CONNECT_OPTIONS.maxReconnectAttempts).toBe(-1);
  });

  it("points at the shared local broker", () => {
    expect(NATS_CONNECT_OPTIONS.servers).toBe(NATS_URL);
  });

  it("waits between attempts instead of hot-looping", () => {
    expect(NATS_CONNECT_OPTIONS.reconnectTimeWait).toBeGreaterThanOrEqual(1_000);
  });

  it("keeps retrying even if the very first connect fails", () => {
    expect(NATS_CONNECT_OPTIONS.waitOnFirstConnect).toBe(true);
  });
});

// The Pi extension is published as a standalone package and deliberately duplicates the
// shared constants (it cannot import from src/). Drift between the two halves is exactly
// the class of bug that caused this investigation, so assert they stay in step.
describe("Pi extension mirrors the reconnect policy", () => {
  const piSource = readFileSync(
    resolve(__dirname, "../../packages/bridge-harness-pi/src/index.ts"),
    "utf8"
  );

  it("declares its own NATS_CONNECT_OPTIONS", () => {
    expect(piSource).toContain("NATS_CONNECT_OPTIONS");
  });

  it("also retries forever", () => {
    expect(piSource).toMatch(/maxReconnectAttempts:\s*-1/);
  });

  it("connects using the options rather than a bare servers object", () => {
    expect(piSource).toMatch(/connect\(NATS_CONNECT_OPTIONS\)/);
    expect(piSource).not.toMatch(/connect\(\{\s*servers:\s*NATS_URL\s*\}\)/);
  });

  it("re-announces its identity after a reconnect", () => {
    expect(piSource).toContain("announceIdentity");
    expect(piSource).toMatch(/status\.type === "reconnect"/);
  });
});
