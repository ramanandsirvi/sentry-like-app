import {
  ingestBatchSchema,
  MAX_BATCH_BODY_BYTES,
  type IngestErrorResponse,
} from "@/lib/contracts/ingest";
import { ingestBatch, IngestConflictError } from "@/lib/server/ingest-service";
import {
  readBoundedBody,
  RequestBodyTooLargeError,
} from "@/lib/server/read-bounded-body";
import { sha256 } from "@/lib/server/serialization";

export const runtime = "nodejs";

function errorResponse(
  status: number,
  code: string,
  message: string,
  issues?: IngestErrorResponse["error"]["issues"],
): Response {
  return Response.json(
    { error: { code, message, ...(issues ? { issues } : {}) } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return errorResponse(
      415,
      "UNSUPPORTED_CONTENT_TYPE",
      "Content-Type must be application/json",
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BATCH_BODY_BYTES
  ) {
    return errorResponse(
      413,
      "BATCH_TOO_LARGE",
      `Batch body exceeds ${MAX_BATCH_BODY_BYTES} bytes`,
    );
  }

  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request, MAX_BATCH_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(413, "BATCH_TOO_LARGE", error.message);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  const validation = ingestBatchSchema.safeParse(parsed);
  if (!validation.success) {
    return errorResponse(
      422,
      "VALIDATION_FAILED",
      "Batch payload failed validation",
      validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  try {
    const result = await ingestBatch(
      validation.data,
      rawBody.byteLength,
      sha256(rawBody),
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
    });
  } catch (error) {
    if (error instanceof IngestConflictError) {
      return errorResponse(409, "ID_CONFLICT", error.message);
    }

    console.error("Failed to ingest error batch", error);
    return errorResponse(
      500,
      "INGESTION_FAILED",
      "The batch could not be processed; retry it with the same IDs",
    );
  }
}
