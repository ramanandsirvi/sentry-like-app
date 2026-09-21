# Engineering notes

This document records the design invariants and tradeoffs behind the first
Tracebox milestone. The goal is not to imitate all of Sentry; it is to make a
small ingestion pipeline whose behavior is understandable, testable, and safe
under retries and concurrent requests.

## System boundaries

- The browser SDK captures console and network failures, owns the in-memory
  queue, and sends ordered batches every three seconds or before 500 KiB.
- `POST /api/ingest` is the trust boundary. It limits the streamed request body,
  validates the versioned contract, stores an immutable receipt, and invokes
  deterministic grouping.
- PostgreSQL is both the durable event store and the consistency boundary for
  this milestone. The inbox reads projections directly from it.
- Authentication, multi-tenancy, notification delivery, retention, and group
  merge/split workflows are deliberate non-goals for v1.

## Ingestion invariants

1. A `batch_id` identifies one exact request body. Reusing it with different
   bytes returns `409 ID_CONFLICT`.
2. An `event_id` identifies one logical occurrence. Reusing it with different
   event content also returns `409 ID_CONFLICT`.
3. Replaying the same batch is safe and returns the original receipts with
   `idempotent_replay: true`.
4. Events and their per-batch receipts are committed together. A partial insert
   cannot become visible.
5. A processed batch has one stable result for each submitted event, in request
   order.

Unique database constraints enforce identity. Content hashes distinguish a
legitimate retry from accidental identifier reuse. Database `CHECK`
constraints protect size, count, sequence, and grouping-version assumptions
even if a future code path bypasses the HTTP schema validator.

## Concurrency model

Storage uses insert-on-conflict semantics instead of a check-then-write race.
Processing acquires a transaction-scoped PostgreSQL advisory lock derived from
the batch ID. Therefore concurrent retries of one batch serialize, while
unrelated batches continue independently.

Groups have a unique `(grouping_version, fingerprint)` key. Concurrent batches
may race to create the same group; one insert wins and the others use atomic
`event_count = event_count + n` updates. `least` and `greatest` preserve the true
time range when events arrive out of order.

The integration suite runs these races against real PostgreSQL. Unit tests alone
would not validate isolation and constraint behavior.

## Grouping strategy

Grouping is deterministic and explainable. Console errors use normalized error
type, message, and the first useful application frame. Network errors use the
normalized endpoint, method, failure kind, status, structured error metadata,
logical operation, and call site. Volatile values such as UUIDs, numeric path
segments, query strings, trace IDs, and durations are excluded.

The fingerprint includes `grouping_version`. A future algorithm can therefore
coexist with historic groups without silently changing their identity. In a
production system, changing this version would be paired with a backfill or an
explicit decision to group only new events under the new algorithm.

## Failure semantics

- Contract failures are terminal client errors: `400`, `413`, `415`, or `422`.
- Identifier conflicts return `409` and require new IDs or corrected content.
- Transient server failures return `500`; the SDK retries the same stable batch
  with exponential backoff, preserving idempotency.
- Capture and diagnostic hooks are isolated from application behavior. A broken
  telemetry callback never changes the result of the host application's fetch.
- A failed processing attempt is recorded on the batch. Retrying the same batch
  reacquires the lock and resumes from ungrouped events.

For a higher-volume design, the API would finish after durable storage and
publish a transactional outbox record. Independent workers would claim jobs
with leases or `FOR UPDATE SKIP LOCKED`, and the UI would expose the intermediate
processing state. Keeping processing synchronous here makes the contract and
demo deterministic without pretending that it is the final scaling model.

## Data minimization

The SDK does not collect cookies, authorization headers, request bodies, or full
response bodies. URLs are stripped of credentials, query strings, and fragments.
For failed HTTP responses it keeps selected structured metadata and a SHA-256 of
a bounded response sample. This is a useful debugging signal without turning
the error product into an accidental sensitive-data store.

The remaining payload is still untrusted and may contain user-provided error
messages. A production rollout would add project-specific scrubbing, retention,
rate limits, payload encryption policy, and access controls before accepting
internet traffic.

## Operational path beyond v1

The next steps would be project-scoped API keys and quotas, asynchronous grouping
through a transactional outbox, partitioned event retention, notification rules
evaluated from group transitions, and metrics for ingest latency, rejected
payloads, retry rate, grouping throughput, and processing failures. Notification
delivery would use an idempotency key per rule/group transition so retries cannot
send duplicate alerts.

## Dependency hygiene

Production and development dependencies have a clean audit. `drizzle-kit`
currently reaches a deprecated loader that pins an old `esbuild`; the scoped npm
override raises only that transitive compiler to its current compatible release.
The migration generator and full local test/build pipeline make that
compatibility decision observable. Schema changes should always be committed
with their generated migration artifacts.

ESLint remains on the latest 9.x release because the React plugin bundled with
the current Next.js release is not yet compatible with ESLint 10. This can move
forward when the framework toolchain does, without disabling any lint rules.
