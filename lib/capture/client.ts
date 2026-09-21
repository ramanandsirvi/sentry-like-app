import type {
  ConsoleErrorEvent,
  ErrorEvent as CapturedErrorEvent,
  NetworkErrorEvent,
  NetworkErrorPayload,
} from "@/lib/contracts/ingest";

type Capture = (event: CapturedErrorEvent) => void;
type DiagnosticHandler = (error: unknown) => void;

function reportDiagnostic(
  onDiagnostic: DiagnosticHandler | undefined,
  error: unknown,
): void {
  try {
    onDiagnostic?.(error);
  } catch {
    // Instrumentation must never affect the host application.
  }
}

function safeCapture(
  capture: Capture,
  event: CapturedErrorEvent,
  onDiagnostic?: DiagnosticHandler,
): void {
  try {
    capture(event);
  } catch (error) {
    reportDiagnostic(onDiagnostic, error);
  }
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  return new Error("Unknown runtime error");
}

export function createConsoleErrorEvent(value: unknown): ConsoleErrorEvent {
  const error = asError(value);
  return {
    event_id: crypto.randomUUID(),
    type: "console_error",
    timestamp: new Date().toISOString(),
    payload: {
      error_name: error.name,
      message: error.message,
      stack: error.stack,
    },
  };
}

export function installRuntimeErrorListeners(
  capture: Capture,
  onDiagnostic?: DiagnosticHandler,
): () => void {
  const handleError = (event: globalThis.ErrorEvent) => {
    safeCapture(
      capture,
      createConsoleErrorEvent(
        event.error ?? new Error(event.message || "Unhandled browser error"),
      ),
      onDiagnostic,
    );
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    safeCapture(capture, createConsoleErrorEvent(event.reason), onDiagnostic);
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
}

async function readResponseSample(
  response: Response,
  maxBytes = 16 * 1024,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let result = "";

  try {
    while (bytesRead < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.slice(0, remaining) : value;
      result += decoder.decode(chunk, { stream: true });
      bytesRead += chunk.byteLength;

      if (value.byteLength > remaining) break;
    }
    result += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return result;
}

async function sha256Sample(value: string): Promise<string | undefined> {
  if (!value) return undefined;
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function sanitizeCapturedUrl(rawUrl: string): string {
  const url = new URL(rawUrl, window.location.href);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

function absoluteUrl(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : String(input);
  return sanitizeCapturedUrl(raw);
}

function methodFor(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function failureKind(error: Error): NetworkErrorPayload["failure"]["kind"] {
  if (error.name === "AbortError") return "abort";
  if (error.name === "TimeoutError") return "timeout";
  if (error instanceof TypeError) return "cors_or_network";
  return "network";
}

export async function trackedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: {
    capture: Capture;
    operation?: string;
    release?: string;
    environment?: string;
    onDiagnostic?: DiagnosticHandler;
  },
): Promise<Response> {
  const startedAt = performance.now();
  const requestUrl = absoluteUrl(input);
  const method = methodFor(input, init);

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (reason) {
    const error = asError(reason);
    const event: NetworkErrorEvent = {
      event_id: crypto.randomUUID(),
      type: "network_error",
      timestamp: new Date().toISOString(),
      payload: {
        request: { method, url: requestUrl, operation: options.operation },
        failure: {
          kind: failureKind(error),
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        timing: { duration_ms: Math.round(performance.now() - startedAt) },
        context: {
          page_url: sanitizeCapturedUrl(window.location.href),
          release: options.release,
          environment: options.environment,
        },
      },
    };
    safeCapture(options.capture, event, options.onDiagnostic);
    throw reason;
  }

  if (response.ok) return response;

  try {
    const sample = await readResponseSample(response.clone());
    const contentType = response.headers.get("content-type") ?? undefined;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (sample && contentType?.includes("application/json")) {
      try {
        const parsed = JSON.parse(sample) as Record<string, unknown>;
        const code = parsed.code ?? parsed.type;
        const message = parsed.message ?? parsed.error;
        if (typeof code === "string") errorCode = code;
        if (typeof message === "string") errorMessage = message;
      } catch {
        // The bounded response sample may be truncated; metadata is optional.
      }
    }

    const failure = new Error(
      errorMessage ?? `${method} ${requestUrl} returned ${response.status}`,
    );
    failure.name = "NetworkRequestError";

    const event: NetworkErrorEvent = {
      event_id: crypto.randomUUID(),
      type: "network_error",
      timestamp: new Date().toISOString(),
      payload: {
        request: {
          method,
          url: requestUrl,
          operation: options.operation,
        },
        response: {
          status: response.status,
          status_text: response.statusText || undefined,
          content_type: contentType,
          error_code: errorCode,
          error_message: errorMessage,
          body_sample_hash: await sha256Sample(sample),
        },
        failure: {
          kind: "http",
          name: failure.name,
          message: failure.message,
          stack: failure.stack,
        },
        timing: { duration_ms: Math.round(performance.now() - startedAt) },
        context: {
          page_url: sanitizeCapturedUrl(window.location.href),
          release: options.release,
          environment: options.environment,
          trace_id:
            response.headers.get("x-request-id") ??
            response.headers.get("traceparent") ??
            undefined,
        },
      },
    };
    safeCapture(options.capture, event, options.onDiagnostic);
  } catch (error) {
    reportDiagnostic(options.onDiagnostic, error);
  }

  return response;
}
