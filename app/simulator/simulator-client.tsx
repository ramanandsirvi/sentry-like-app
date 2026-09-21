"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ErrorBatcher, type BatcherSnapshot } from "@/lib/capture/batcher";
import {
  createConsoleErrorEvent,
  installRuntimeErrorListeners,
  trackedFetch,
} from "@/lib/capture/client";
import type {
  IngestBatch,
  IngestErrorResponse,
  IngestSuccessResponse,
} from "@/lib/contracts/ingest";

const initialSnapshot: BatcherSnapshot = {
  queuedEventCount: 0,
  queuedBytes: 0,
  pendingBatchCount: 0,
  pendingEventCount: 0,
  isSending: false,
  nextFlushAt: null,
  lastBatch: null,
  lastError: null,
};

async function sendBatch(batch: IngestBatch): Promise<IngestSuccessResponse> {
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batch),
  });
  const data = (await response.json()) as
    IngestSuccessResponse | IngestErrorResponse;

  if (!response.ok || !("status" in data)) {
    const message =
      "error" in data
        ? data.error.message
        : `Ingestion failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

function randomEntityId(): number {
  return Math.floor(100 + Math.random() * 900);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KiB`;
}

export function SimulatorClient() {
  const [batcher] = useState(() => new ErrorBatcher(sendBatch));
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState(
    "Choose a scenario. Events flush after three seconds.",
  );
  const [expectedResult, setExpectedResult] = useState(
    "The result will appear here before you inspect it in the inbox.",
  );

  useEffect(() => {
    const unsubscribe = batcher.subscribe(setSnapshot);
    const removeListeners = installRuntimeErrorListeners((event) =>
      batcher.capture(event),
    );
    const clock = window.setInterval(() => setNow(Date.now()), 100);

    return () => {
      unsubscribe();
      removeListeners();
      window.clearInterval(clock);
      batcher.dispose();
    };
  }, [batcher]);

  const captureConsole = (message?: string) => {
    const error = new TypeError(
      message ?? `User ${randomEntityId()} failed to load checkout settings`,
    );
    batcher.capture(createConsoleErrorEvent(error));
  };

  const simulateConsole = () => {
    captureConsole();
    setActionStatus("Queued one console error.");
    setExpectedResult("Expected result: 1 occurrence in 1 console issue.");
  };

  const simulateRepeatedConsole = () => {
    for (let index = 0; index < 5; index += 1) {
      captureConsole(
        `User ${randomEntityId()} failed to load checkout settings`,
      );
    }
    setActionStatus("Queued five variations that should become one group.");
    setExpectedResult(
      "Expected result: 5 occurrences collapse into 1 console issue.",
    );
  };

  const captureNetwork = async (variant: "payment" | "inventory") => {
    const orderId = randomEntityId();
    await trackedFetch(
      `/api/simulator/network-error?variant=${variant}&orderId=${orderId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      },
      {
        capture: (event) => batcher.capture(event),
        operation:
          variant === "payment" ? "submit_checkout" : "reserve_inventory",
        release: "error-inbox-demo-1",
        environment: "development",
      },
    );
  };

  const simulateNetwork = async (variant: "payment" | "inventory") => {
    setActiveScenario(variant);
    setActionStatus(`Calling the failing ${variant} endpoint…`);
    setExpectedResult("Expected result: 1 occurrence in 1 network issue.");

    try {
      await captureNetwork(variant);
      setActionStatus(
        `Captured a real HTTP 500 with a structured ${variant} error code.`,
      );
    } catch {
      setActionStatus(
        `The ${variant} request could not be completed. The SDK captured the transport failure.`,
      );
    } finally {
      setActiveScenario(null);
    }
  };

  const simulateMixedBurst = async () => {
    setActiveScenario("guided");
    setActionStatus("Running the recommended seven-event walkthrough…");
    setExpectedResult(
      "Expected result: 7 occurrences become 3 issues—one console and two network.",
    );

    for (let index = 0; index < 5; index += 1) {
      captureConsole(
        `User ${randomEntityId()} failed to load checkout settings`,
      );
    }

    try {
      await Promise.all([
        captureNetwork("payment"),
        captureNetwork("inventory"),
      ]);
      setActionStatus(
        "Seven events are queued. Watch the batcher deliver them, then review the three issues.",
      );
    } catch {
      setActionStatus(
        "The walkthrough captured a transport failure; queued events will still be delivered.",
      );
    } finally {
      setActiveScenario(null);
    }
  };

  const countdown = snapshot.nextFlushAt
    ? Math.max(0, snapshot.nextFlushAt - now)
    : null;

  return (
    <>
      <section
        className="panel demo-mission"
        aria-labelledby="demo-mission-title"
      >
        <div className="demo-mission-copy">
          <span className="recommended-pill">Recommended walkthrough</span>
          <h2 id="demo-mission-title">Prove the full workflow in one click</h2>
          <p>
            Generate seven realistic occurrences, observe one batch, and verify
            that normalization produces three actionable issues.
          </p>
        </div>
        <ol className="demo-steps">
          <li>
            <span>1</span>
            <div>
              <strong>Capture</strong>
              <small>7 occurrences</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Batch</strong>
              <small>1 delivery</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Group</strong>
              <small>3 issues</small>
            </div>
          </li>
        </ol>
        <button
          className="primary-button guided-demo-button"
          onClick={() => void simulateMixedBurst()}
          disabled={activeScenario !== null}
        >
          {activeScenario === "guided" ? "Running demo…" : "Run guided demo"}
        </button>
      </section>

      <div className="simulator-grid">
        <section className="panel scenario-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Explore scenarios</p>
              <h2>Test one behavior at a time</h2>
            </div>
            <span className="live-pill">
              <i /> runtime listeners on
            </span>
          </div>

          <div className="scenario-list">
            <button
              className="scenario-card"
              onClick={simulateConsole}
              disabled={activeScenario !== null}
            >
              <span className="scenario-icon console-icon">›_</span>
              <span>
                <strong>Console error</strong>
                <small>A TypeError with a changing user identifier</small>
              </span>
              <b>Generate</b>
            </button>

            <button
              className="scenario-card"
              onClick={simulateRepeatedConsole}
              disabled={activeScenario !== null}
            >
              <span className="scenario-icon burst-icon">×5</span>
              <span>
                <strong>Repeated console errors</strong>
                <small>Five occurrences that normalize into one issue</small>
              </span>
              <b>Generate</b>
            </button>

            <button
              className="scenario-card"
              onClick={() => void simulateNetwork("payment")}
              disabled={activeScenario !== null}
            >
              <span className="scenario-icon network-icon">500</span>
              <span>
                <strong>Payment API failure</strong>
                <small>Real HTTP request with PAYMENT_PROVIDER_TIMEOUT</small>
              </span>
              <b>{activeScenario === "payment" ? "Calling…" : "Call API"}</b>
            </button>

            <button
              className="scenario-card"
              onClick={() => void simulateNetwork("inventory")}
              disabled={activeScenario !== null}
            >
              <span className="scenario-icon network-icon">500</span>
              <span>
                <strong>Inventory API failure</strong>
                <small>Same route shape, distinct structured error code</small>
              </span>
              <b>{activeScenario === "inventory" ? "Calling…" : "Call API"}</b>
            </button>
          </div>

          <div className="scenario-feedback" aria-live="polite">
            <span>Latest action</span>
            <strong>{actionStatus}</strong>
            <small>{expectedResult}</small>
          </div>
        </section>

        <aside className="panel batch-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Browser batcher</p>
              <h2>Delivery state</h2>
            </div>
            <span
              className={
                snapshot.isSending ? "status-dot sending" : "status-dot"
              }
            >
              {snapshot.isSending ? "sending" : "idle"}
            </span>
          </div>

          <div className="metric-grid">
            <div className="metric-card">
              <span>Queued</span>
              <strong>{snapshot.queuedEventCount}</strong>
              <small>{formatBytes(snapshot.queuedBytes)}</small>
            </div>
            <div className="metric-card">
              <span>Outbox</span>
              <strong>{snapshot.pendingBatchCount}</strong>
              <small>{snapshot.pendingEventCount} events</small>
            </div>
          </div>

          <div className="flush-meter">
            <div className="flush-copy">
              <span>Next time flush</span>
              <strong>
                {countdown === null
                  ? "Waiting"
                  : `${(countdown / 1_000).toFixed(1)}s`}
              </strong>
            </div>
            <div className="meter-track">
              <span
                style={{
                  width: `${countdown === null ? 0 : Math.max(0, (countdown / 3_000) * 100)}%`,
                }}
              />
            </div>
            <div className="limit-copy">
              <span>Body limit</span>
              <span>{formatBytes(snapshot.queuedBytes)} / 500 KiB</span>
            </div>
          </div>

          <button
            className="secondary-button"
            onClick={() => batcher.flush("manual")}
          >
            Flush now
          </button>

          {snapshot.lastError ? (
            <div className="delivery-message error-message" role="alert">
              <strong>Delivery failed</strong>
              <span>{snapshot.lastError}</span>
            </div>
          ) : null}

          {snapshot.lastBatch ? (
            <div
              className="delivery-message success-message"
              aria-live="polite"
            >
              <strong>Batch processed</strong>
              <span>{snapshot.lastBatch.batchId}</span>
              <dl>
                <div>
                  <dt>Accepted</dt>
                  <dd>{snapshot.lastBatch.response.accepted_count}</dd>
                </div>
                <div>
                  <dt>Groups</dt>
                  <dd>{snapshot.lastBatch.response.groups_touched}</dd>
                </div>
                <div>
                  <dt>Trigger</dt>
                  <dd>{snapshot.lastBatch.reason}</dd>
                </div>
              </dl>
              <Link href="/inbox" className="delivery-link">
                Review grouped issues →
              </Link>
            </div>
          ) : (
            <div className="empty-delivery">
              No batch has been delivered yet.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
