## 1. Enable JetStream on the managed server

- [x] 1.1 Add `-js` and `--store_dir /tmp/bridge-harness-js` to the `nats-server` spawn args in `src/nats-manager/`
- [x] 1.2 Ensure the store dir exists (create if missing) before launch
- [x] 1.3 Surface a clear error when JetStream is unavailable (handled at stream-ensure time in the MCP warning + the hook's core fallback)

## 2. Provision the BRIDGE_DM stream

- [x] 2.1 Add `src/shared/jetstream.ts` with `ensureDmStream(nc)` + `dmStreamConfig()` (subjects `bridge.dm.*`, file storage, `limits` retention, `max_msgs_per_subject: 100`, `max_age: 1800s`, `max_bytes: 64MB`) — idempotent
- [x] 2.2 Call `ensureDmStream` on MCP startup after connecting
- [x] 2.3 Wrap stream creation so a JetStream-disabled server logs a clear warning and continues on core behavior

## 3. Switch the rewake hook to a durable consumer

- [x] 3.1 Replace the core DM subscribe with a durable JetStream consumer on `bridge.dm.<agentId>` (durable `rewake-<agentId>`)
- [x] 3.2 On delivery: emit one wake for the batch (250ms debounce), `ack()` all, then exit(2)
- [x] 3.3 Keep the project-room wake AND the canonical `claude-code` alias on core NATS (raced with the JetStream consumer)
- [x] 3.4 Fall back to the core DM subscribe when JetStream is unavailable

## 4. Remove the interim file mechanism

- [x] 4.1 Confirm no references remain to `/tmp/agent-bridge-<agentId>.txt`, `writePending`, or the hook's pending-poll (reverted on this branch)

## 5. Tests

- [x] 5.1 Unit test: `dmStreamConfig` builds the expected stream config (subjects + retention values) — `tests/jetstream/`
- [x] 5.2 Live smoke test (real nats-server `-js`): a DM published while the consumer was disconnected is delivered on connect (redelivery of missed) — validated; 3-message burst collapses to one wake
- [x] 5.3 Live smoke test: an acked message is not redelivered (no wake loop) — validated
- [ ] 5.4 Add an automated JetStream integration test fixture (spins up `nats-server -js`) covering redelivery + `max_age` expiry — deferred (needs a server fixture; behavior smoke-validated)
- [x] 5.5 Verify room messages and the `send` path are unchanged (existing suite green; rooms not captured by the stream)

## 6. Docs & release

- [x] 6.1 Update READMEs: DM durability via JetStream, store dir, 30-min retention; rooms stay ephemeral
- [x] 6.2 Note that a remote/cloud `nats-server` must have JetStream enabled
- [ ] 6.3 Bump both package versions in lockstep and run the full build + test suite
