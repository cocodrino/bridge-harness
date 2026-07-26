## ADDED Requirements

### Requirement: Durable retention of direct messages
The system SHALL retain direct messages published to `bridge.dm.*` in a JetStream stream so
they survive brief consumer outages, bounded by a per-subject count, a maximum age, and a
maximum total size.

#### Scenario: A sent DM is retained
- **WHEN** an agent sends a DM to `agent:<id>` (a core publish to `bridge.dm.<id>`)
- **THEN** the message is stored in the `BRIDGE_DM` stream without changing the send path

#### Scenario: Retention is bounded per recipient
- **WHEN** more than the configured `max_msgs_per_subject` messages exist for one recipient
- **THEN** the oldest messages for that recipient are discarded, and other recipients' messages are unaffected

#### Scenario: Messages expire by age
- **WHEN** a stored DM is older than the configured `max_age` (30 minutes)
- **THEN** it is removed from the stream and never redelivered

### Requirement: The rewake hook wakes Claude for every DM
The rewake hook SHALL consume DMs through a durable JetStream consumer and acknowledge each
message only after emitting the wake, so that a message it did not receive (because it was
between exit and reconnect) remains unacknowledged and is redelivered.

#### Scenario: A reply that arrives during the hook restart still wakes Claude
- **WHEN** a DM arrives while the hook is restarting (not currently subscribed)
- **THEN** on the hook's next connect the message is redelivered and Claude is woken to read it

#### Scenario: An already-woken message is not redelivered
- **WHEN** the hook has emitted a wake for a message and acknowledged it
- **THEN** that message is not redelivered, so the hook does not enter a wake loop

### Requirement: Offline recipients receive missed DMs within the retention window
A recipient's durable consumer SHALL redeliver DMs that were published while the recipient
was offline, provided they are still within the retention window.

#### Scenario: Recipient reconnects within the window
- **WHEN** a recipient was offline when a DM was sent and reconnects within `max_age`
- **THEN** the un-acknowledged DM is redelivered to it

#### Scenario: Recipient reconnects after the window
- **WHEN** a recipient reconnects after the DM has expired by age
- **THEN** the DM is not delivered (it no longer exists)

### Requirement: Rooms and the send API are unaffected
The change SHALL be scoped to DMs only: room messaging stays on core NATS (ephemeral), and
the `send` tool's inputs and behavior do not change.

#### Scenario: Room messages remain ephemeral
- **WHEN** an agent sends to `room:<name>`
- **THEN** the message is delivered over core NATS with no durability or redelivery

#### Scenario: Sending requires no new parameters
- **WHEN** an agent calls `send`
- **THEN** it uses the same `to`/`message` inputs as before, with no JetStream-specific arguments
