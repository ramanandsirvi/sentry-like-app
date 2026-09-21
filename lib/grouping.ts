import { createHash } from "node:crypto";

import {
  GROUPING_VERSION,
  type ErrorEvent,
  type NetworkErrorEvent,
} from "@/lib/contracts/ingest";

export interface GroupingProjection {
  groupingVersion: number;
  fingerprint: string;
  normalizedSummary: string;
  title: string;
  culprit: string | null;
}

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ISO_TIMESTAMP_PATTERN =
  /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})\b/gi;
const HEX_PATTERN = /\b(?:0x)?[0-9a-f]{12,}\b/gi;
const NAMED_ID_PATTERN =
  /\b(user|order|account|item|request|session|tenant)(?:\s+id)?\s*[#:=]?\s*\d+\b/gi;
const LONG_NUMBER_PATTERN = /\b\d{6,}\b/g;

export function normalizeMessage(value: string): string {
  return value
    .normalize("NFKC")
    .replace(ISO_TIMESTAMP_PATTERN, ":timestamp")
    .replace(UUID_PATTERN, ":uuid")
    .replace(HEX_PATTERN, ":hex")
    .replace(NAMED_ID_PATTERN, (_match, label: string) => `${label} :id`)
    .replace(LONG_NUMBER_PATTERN, ":number")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePathSegment(segment: string): string {
  if (
    /^\d+$/.test(segment) ||
    UUID_PATTERN.test(segment) ||
    /^(?:0x)?[0-9a-f]{12,}$/i.test(segment)
  ) {
    UUID_PATTERN.lastIndex = 0;
    return ":id";
  }

  UUID_PATTERN.lastIndex = 0;
  return segment.toLowerCase();
}

export function normalizeEndpoint(rawUrl: string): {
  endpoint: string;
  pathname: string;
} {
  try {
    const url = new URL(rawUrl);
    const pathname =
      "/" +
      url.pathname
        .split("/")
        .filter(Boolean)
        .map(normalizePathSegment)
        .join("/");

    return {
      endpoint: `${url.host.toLowerCase()}${pathname}`,
      pathname,
    };
  } catch {
    const sanitized = rawUrl.split(/[?#]/, 1)[0].toLowerCase();
    return { endpoint: sanitized, pathname: sanitized };
  }
}

function sanitizeStackLocation(value: string): string {
  return value
    .replace(/[?#].*$/, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^(?:webpack-internal:\/\/|file:\/\/)/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/_next\/static\/chunks\/[^/]+$/, "_next/static/chunks/:bundle")
    .replace(/^.*?(?=(?:app|src|lib)\/)/, "")
    .trim();
}

export function extractRelevantStackFrame(stack?: string): string | null {
  if (!stack) return null;

  const frames = stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));

  const frame =
    frames.find(
      (line) =>
        !/node_modules|next[\\/]dist|react-dom|lib[\\/]capture/i.test(line),
    ) ?? frames[0];

  if (!frame) return null;

  const withFunction = frame.match(/^at\s+(.+?)\s+\((.+)\)$/);
  if (withFunction) {
    return `${withFunction[1]}@${sanitizeStackLocation(withFunction[2])}`;
  }

  return sanitizeStackLocation(frame.replace(/^at\s+/, ""));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value: string, length = 180): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function groupNetworkEvent(event: NetworkErrorEvent): GroupingProjection {
  const { request, response, failure } = event.payload;
  const method = request.method.toUpperCase();
  const { endpoint, pathname } = normalizeEndpoint(request.url);
  const status = response?.status ? String(response.status) : "no_response";
  const errorCode = normalizeMessage(response?.error_code ?? "no_error_code");
  const message = normalizeMessage(
    response?.error_message ?? failure.message ?? response?.status_text ?? "",
  );
  const callSite = extractRelevantStackFrame(failure.stack);
  const operation = normalizeMessage(request.operation ?? "");
  const normalizedSummary = [
    "network_error",
    method,
    endpoint,
    failure.kind,
    status,
    errorCode,
    message,
    operation,
    callSite ?? "",
  ].join("|");

  const title = response?.error_code
    ? `${response.error_code}: ${response.error_message ?? response.status_text ?? "Request failed"}`
    : response
      ? `${method} ${pathname} returned ${response.status}`
      : `${method} ${pathname} failed: ${failure.message ?? failure.kind}`;

  return {
    groupingVersion: GROUPING_VERSION,
    fingerprint: digest(normalizedSummary),
    normalizedSummary,
    title: truncate(title),
    culprit: request.operation ?? `${method} ${endpoint}`,
  };
}

export function groupErrorEvent(event: ErrorEvent): GroupingProjection {
  if (event.type === "network_error") {
    return groupNetworkEvent(event);
  }

  const errorName = normalizeMessage(event.payload.error_name ?? "Error");
  const message = normalizeMessage(event.payload.message);
  const callSite = extractRelevantStackFrame(event.payload.stack);
  const normalizedSummary = [
    "console_error",
    errorName,
    message,
    callSite ?? "",
  ].join("|");
  const displayName = event.payload.error_name ?? "Error";

  return {
    groupingVersion: GROUPING_VERSION,
    fingerprint: digest(normalizedSummary),
    normalizedSummary,
    title: truncate(`${displayName}: ${event.payload.message}`),
    culprit: callSite ?? event.payload.source ?? null,
  };
}
