import { RetentionPolicy, StorageType, type NatsConnection } from "nats";

// DMs are captured by this stream so a durable consumer (the rewake hook) can be
// redelivered anything it missed during its restart, and offline recipients can catch
// up within the retention window. Rooms are intentionally NOT captured (ephemeral).
export const DM_STREAM = "BRIDGE_DM";
export const DM_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
export const DM_MAX_MSGS_PER_SUBJECT = 100;
export const DM_MAX_BYTES = 64 * 1024 * 1024; // 64 MB

export function dmStreamConfig() {
  return {
    name: DM_STREAM,
    subjects: ["bridge.dm.*"],
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    max_msgs_per_subject: DM_MAX_MSGS_PER_SUBJECT,
    max_age: DM_MAX_AGE_MS * 1_000_000, // JetStream expects nanoseconds
    max_bytes: DM_MAX_BYTES,
  };
}

// Idempotently ensure the DM stream exists. Throws if JetStream is not enabled on the
// server, so callers can decide to warn and fall back to core-only behavior.
export async function ensureDmStream(nc: NatsConnection): Promise<void> {
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.info(DM_STREAM);
  } catch {
    await jsm.streams.add(dmStreamConfig() as Parameters<typeof jsm.streams.add>[0]);
  }
}
