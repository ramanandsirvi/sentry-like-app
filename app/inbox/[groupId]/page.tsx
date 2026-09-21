import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getGroupDetail } from "@/lib/server/group-queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Issue detail",
  description: "Inspect occurrences and the deterministic grouping signature.",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  if (!z.string().uuid().safeParse(groupId).success) notFound();

  const detail = await getGroupDetail(groupId);
  if (!detail) notFound();

  const { group, events } = detail;
  const latestEvent = events[0];

  return (
    <div className="page-shell detail-page">
      <Link href="/inbox" className="back-link">
        ← Back to inbox
      </Link>

      <header className="detail-header">
        <div className={`type-badge large ${group.type}`}>
          {group.type === "console_error" ? "JS" : "HTTP"}
        </div>
        <div>
          <div className="detail-kicker">
            <span className="open-state">Open</span>
            <code>{group.groupId.slice(0, 8)}</code>
          </div>
          <h1>{group.title}</h1>
          <p>{group.culprit ?? "No culprit available"}</p>
        </div>
      </header>

      <section className="detail-stats">
        <div>
          <span>Events</span>
          <strong>{group.eventCount}</strong>
        </div>
        <div>
          <span>First seen</span>
          <strong>{formatDate(group.firstSeenAt)}</strong>
        </div>
        <div>
          <span>Last seen</span>
          <strong>{formatDate(group.lastSeenAt)}</strong>
        </div>
        <div>
          <span>Grouping version</span>
          <strong>v{group.groupingVersion}</strong>
        </div>
      </section>

      <section
        className="investigation-path"
        aria-label="Suggested investigation path"
      >
        <span>Suggested investigation</span>
        <p>
          Start with <strong>{group.culprit ?? "the latest occurrence"}</strong>
          , then compare occurrence payloads below. The grouping signature
          remains visible alongside the evidence so the match is auditable.
        </p>
      </section>

      <div className="detail-grid">
        <section className="panel payload-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Latest occurrence</p>
              <h2>Captured payload</h2>
            </div>
          </div>
          {latestEvent ? (
            <pre>
              <code>{JSON.stringify(latestEvent.payload, null, 2)}</code>
            </pre>
          ) : null}
        </section>

        <aside className="panel grouping-panel">
          <p className="eyebrow">Why these grouped</p>
          <h2>Normalized signature</h2>
          <p>
            Volatile identifiers, timestamps, and query parameters are removed
            before hashing this canonical value.
          </p>
          <code className="signature-code">
            {latestEvent?.normalizedSummary ?? "Not available"}
          </code>
          <div className="fingerprint-block">
            <span>SHA-256 fingerprint</span>
            <code>{group.fingerprint}</code>
          </div>
        </aside>
      </div>

      <section className="occurrence-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>Recent occurrences</h2>
          </div>
          <span>
            Showing {events.length} of {group.eventCount}
          </span>
        </div>
        <div className="occurrence-list">
          {events.map((event) => (
            <details key={event.eventId}>
              <summary>
                <span className="event-id">{event.eventId.slice(0, 8)}</span>
                <time>{formatDate(event.occurredAt)}</time>
                <span>
                  {event.type === "console_error" ? "Console" : "Network"}
                </span>
                <b>View payload</b>
              </summary>
              <pre>
                <code>{JSON.stringify(event.payload, null, 2)}</code>
              </pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
