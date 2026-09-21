export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") ?? "payment";
  const requestId = crypto.randomUUID();

  const payload =
    variant === "inventory"
      ? {
          code: "INVENTORY_RESERVATION_FAILED",
          message: "Inventory could not be reserved for this order",
        }
      : {
          code: "PAYMENT_PROVIDER_TIMEOUT",
          message: "Payment provider did not respond",
        };

  return Response.json(payload, {
    status: 500,
    headers: { "x-request-id": requestId },
  });
}
