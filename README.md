# Tracebox

> An error inbox and grouping prototype built as an interview project for the
> SaaS Labs hiring process, with the JustCall product in mind.

Tracebox takes noisy browser failures and turns them into a small set of issues
a product or engineering team can actually investigate. It captures console and
network errors, batches them in the browser, ingests them safely, and groups
similar occurrences behind an explainable fingerprint.

The brief also included notification rules. I intentionally stopped this
milestone at the error inbox and grouping layer: notifications are only useful
once the underlying issue identity is trustworthy.

## The two-minute walkthrough

Start PostgreSQL and the app:

```bash
npm install
npm run db:up
npm run db:migrate
npm run dev
```

Then open [the simulator](http://localhost:3000/simulator) and choose **Run
guided demo**.

That single action creates seven occurrences:

- Five console errors with different user IDs. They should collapse into one
  issue.
- One payment provider failure.
- One inventory reservation failure.

The browser waits three seconds, sends one batch, and shows the delivery result.
Follow **Review grouped issues** to the inbox. You should see seven new
occurrences represented by three issues, not seven disconnected rows.

Open an issue to see the raw occurrence beside the normalized signature and its
SHA-256 fingerprint. This is the most important screen in the project: it makes
the grouping decision inspectable instead of asking the user to trust a black
box.

## Why I designed it this way

For a product like JustCall, a single user action can cross browser code,
multiple APIs, and third-party services. The useful question is rarely “how many
errors arrived?” It is “which customer-facing problems are happening, how often,
and are these failures actually related?”

That led to a few deliberate product decisions:

### Show issues, preserve occurrences

The inbox is organized around issues so it remains useful during a burst. Every
original occurrence is still available on the detail page for investigation.
Grouping reduces noise; it does not discard evidence.

### Make grouping explainable

The detail view shows the exact normalized signature used to produce a group.
Dynamic user IDs, UUIDs, timestamps, query strings, and numeric path segments are
removed before hashing. Error codes, operations, HTTP status, endpoint shape,
and useful call-site information remain.

### Demonstrate behavior, not just buttons

The simulator sets an expected result before it sends anything. Its recommended
walkthrough proves capture, batching, ingestion, grouping, and investigation as
one connected journey. Individual scenarios are still available when someone
wants to test one behavior in isolation.

### Collect enough network context, but not everything

Network events keep method, sanitized URL, operation, status, structured error
metadata, duration, release, environment, trace ID, and a hash of a bounded
response sample. The SDK does not collect cookies, authorization headers,
request bodies, or complete response bodies.

## How the system works

The browser capture layer feeds an in-memory batcher. The batcher seals its
current queue after three seconds or before the encoded request would exceed 500
KiB. Sealed batches enter an ordered outbox and retain the same IDs across
retries.

`POST /api/ingest` is the trust boundary. It:

1. Rejects unsupported content types and streams the request through a hard size
   limit.
2. Validates the versioned payload with Zod.
3. Stores the batch, events, and ordered receipts in PostgreSQL.
4. Builds a deterministic grouping projection for each accepted event.
5. Returns the outcome and group ID for every submitted event.

PostgreSQL is doing more than storage here. Unique constraints, transactions,
atomic counters, and advisory locks protect the invariants when requests are
retried or arrive concurrently.

## API contract

A batch sent to `POST /api/ingest` looks like this:

```json
{
  "schema_version": 1,
  "batch_id": "1b49a372-a8d1-4b3a-b86a-0d4807043158",
  "timestamp": "2026-09-21T11:31:00.000Z",
  "errors": [
    {
      "event_id": "583751ed-c912-45b9-ae06-ac85fcba6d50",
      "type": "network_error",
      "timestamp": "2026-09-21T11:31:00.000Z",
      "payload": {
        "request": {
          "method": "POST",
          "url": "https://api.example.test/orders/9",
          "operation": "create_order"
        },
        "response": {
          "status": 503,
          "error_code": "UPSTREAM_UNAVAILABLE",
          "error_message": "Inventory unavailable"
        },
        "failure": {
          "kind": "http",
          "name": "NetworkRequestError",
          "message": "Request failed"
        }
      }
    }
  ]
}
```

A successful response includes counts and one ordered receipt per event:

```json
{
  "batch_id": "1b49a372-a8d1-4b3a-b86a-0d4807043158",
  "status": "processed",
  "accepted_count": 1,
  "duplicate_count": 0,
  "groups_touched": 1,
  "processed_at": "2026-09-21T11:31:00.120Z",
  "idempotent_replay": false,
  "results": [
    {
      "event_id": "583751ed-c912-45b9-ae06-ac85fcba6d50",
      "group_id": "11824fb2-5fb4-4a1e-83c2-5ac8059c1e52",
      "outcome": "accepted",
      "is_new_group": true
    }
  ]
}
```

Replaying the same batch is safe. Reusing a batch or event ID with different
content returns `409 ID_CONFLICT` rather than silently corrupting identity.

## Grouping rules

Console errors are grouped from:

- Error type and normalized message.
- The first useful application stack frame.

Network errors are grouped from:

- HTTP method and normalized endpoint shape.
- Failure kind and response status.
- Structured error code and message.
- Logical operation and useful call site.

The fingerprint includes a grouping version. This gives a future algorithm a
clean migration path instead of changing the meaning of historical groups in
place.

## Reliability details worth reviewing

- Batch and event IDs are independently idempotent.
- A reused ID with different content is treated as a conflict.
- Batch storage and event receipts commit together.
- Concurrent retries of one batch are serialized with a transaction-scoped
  PostgreSQL advisory lock.
- Concurrent batches updating the same group use a unique fingerprint key and
  atomic occurrence counters.
- SDK instrumentation is isolated from application behavior. A broken capture
  callback cannot change the response or exception produced by the host app.
- Failed deliveries retry with exponential backoff while preserving the batch
  identity.

The integration tests exercise the concurrency claims against a real PostgreSQL
instance rather than mocking them.

## Project structure

```text
app/api/ingest/                 HTTP ingestion boundary
app/simulator/                  Guided demo and individual failure scenarios
app/inbox/                      Group list and issue investigation views
lib/capture/                    Browser capture, batching, retry, and fetch wrapper
lib/contracts/                  Versioned runtime and TypeScript contracts
lib/server/ingest-service.ts    Transactional storage and grouping orchestration
lib/grouping.ts                 Normalization and deterministic fingerprints
db/schema.ts                    PostgreSQL schema and integrity constraints
db/migrations/                  Generated database migrations
docs/engineering-notes.md       Invariants, tradeoffs, and scaling path
```

## Local development

Docker Desktop is required. PostgreSQL runs on `localhost:5433` and persists its
data in the `error-inbox-postgres` volume. Set `DATABASE_URL` to override the
default connection; `.env.example` contains the expected format.

Useful commands:

```bash
npm run dev                 # start the application
npm run db:up               # start PostgreSQL
npm run db:migrate          # apply committed migrations
npm run db:generate         # generate a migration after a schema change
npm run db:studio           # inspect the database with Drizzle Studio
npm run db:down             # stop PostgreSQL without deleting its volume
npm run format:check        # check formatting
npm run lint                # run ESLint
npm run typecheck           # run TypeScript without emitting files
npm test                    # unit tests
npm run test:integration    # real-PostgreSQL concurrency tests
npm run build               # production Next.js build
```

## Scope and next steps

This version deliberately uses one project, no authentication, same-origin
ingestion, and synchronous grouping. Those constraints keep the exercise focused
on event identity, delivery semantics, and grouping quality.

The next product milestone would add notification rules on top of group
transitions—for example, notify when a new issue appears, when an open issue
crosses an occurrence threshold, or when a resolved issue regresses. Delivery
would use an idempotency key per rule and transition so retries could not send
duplicate alerts.

Beyond that, I would add project-scoped API keys and quotas, server-side data
scrubbing, retention controls, asynchronous processing through a transactional
outbox, and manual merge/split controls for the cases where deterministic
grouping needs human correction.

More detail on the consistency model and tradeoffs is available in
[the engineering notes](docs/engineering-notes.md).
