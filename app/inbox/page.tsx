import type { Metadata } from "next";
import Link from "next/link";

import {
  getInboxGroups,
  type InboxTypeFilter,
} from "@/lib/server/group-queries";

import { AutoRefresh } from "./auto-refresh";
import { DatabaseUnavailable } from "./database-unavailable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Error inbox",
  description: "Prioritize grouped console and network failures.",
};

const filters: Array<{ value: InboxTypeFilter; label: string }> = [
  { value: "all", label: "All errors" },
  { value: "console_error", label: "Console" },
  { value: "network_error", label: "Network" },
];

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function validFilter(value: string | undefined): InboxTypeFilter {
  return value === "console_error" || value === "network_error" ? value : "all";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const query = await searchParams;
  const activeFilter = validFilter(query.type);
  let groups: Awaited<ReturnType<typeof getInboxGroups>> | null = null;

  try {
    groups = await getInboxGroups(activeFilter);
  } catch (error) {
    console.error("Could not load the error inbox", error);
  }

  const occurrenceCount =
    groups?.reduce((total, group) => total + group.eventCount, 0) ?? 0;
  const consoleGroupCount =
    groups?.filter((group) => group.type === "console_error").length ?? 0;
  const networkGroupCount =
    groups?.filter((group) => group.type === "network_error").length ?? 0;

  return (
    <div className="page-shell">
      <header className="page-header inbox-header">
        <div>
          <p className="eyebrow">Issues</p>
          <h1>Error inbox</h1>
          <p>
            Prioritize repeated failures and inspect why similar occurrences
            were grouped.
          </p>
        </div>
        {groups ? <AutoRefresh /> : null}
      </header>

      {groups ? (
        <>
          <section className="inbox-summary" aria-label="Current inbox summary">
            <div>
              <span>Open issues</span>
              <strong>{groups.length}</strong>
              <small>in the current view</small>
            </div>
            <div>
              <span>Occurrences</span>
              <strong>{occurrenceCount}</strong>
              <small>across visible issues</small>
            </div>
            <div>
              <span>Console</span>
              <strong>{consoleGroupCount}</strong>
              <small>grouped issues</small>
            </div>
            <div>
              <span>Network</span>
              <strong>{networkGroupCount}</strong>
              <small>grouped issues</small>
            </div>
          </section>

          <div className="inbox-toolbar">
            <div className="filter-pills" aria-label="Filter issues by type">
              {filters.map((filter) => (
                <Link
                  key={filter.value}
                  href={
                    filter.value === "all"
                      ? "/inbox"
                      : `/inbox?type=${filter.value}`
                  }
                  className={activeFilter === filter.value ? "active" : ""}
                >
                  {filter.label}
                </Link>
              ))}
            </div>
            <span>Newest activity first · open issues only</span>
          </div>

          {groups.length ? (
            <section className="issue-list" aria-label="Error groups">
              <div className="issue-list-heading">
                <span>Issue and suspected source</span>
                <span>Events</span>
                <span>First seen</span>
                <span>Last seen</span>
              </div>
              {groups.map((group) => (
                <Link
                  href={`/inbox/${group.groupId}`}
                  className="issue-row"
                  key={group.groupId}
                >
                  <div className="issue-main">
                    <span className={`type-badge ${group.type}`}>
                      {group.type === "console_error" ? "JS" : "HTTP"}
                    </span>
                    <div>
                      <strong>{group.title}</strong>
                      <small>{group.culprit ?? "No culprit available"}</small>
                    </div>
                  </div>
                  <span className="event-count">{group.eventCount}</span>
                  <time dateTime={group.firstSeenAt.toISOString()}>
                    {formatDate(group.firstSeenAt)}
                  </time>
                  <time dateTime={group.lastSeenAt.toISOString()}>
                    {formatDate(group.lastSeenAt)}
                  </time>
                </Link>
              ))}
            </section>
          ) : (
            <section className="empty-inbox panel">
              <span>✓</span>
              <h2>No errors yet</h2>
              <p>
                Generate a few failures in the simulator and they will appear
                here.
              </p>
              <Link href="/simulator" className="primary-button">
                Open simulator
              </Link>
            </section>
          )}
        </>
      ) : (
        <DatabaseUnavailable />
      )}
    </div>
  );
}
