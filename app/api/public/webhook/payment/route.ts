import { getDb, rid } from "@/server/db/connection";
import { publish } from "@/server/event-queue/publisher";

export async function POST(req: Request) {
  let payload: Record<string, any>;
  try {
    payload = await req.json();
  } catch {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "billing.webhook.invalidPayload",
        },
      },
      { status: 400 },
    );
  }

  const transactionId = payload.transactionId as string;
  const providerStatus = payload.status as string;
  const invoiceUrl = payload.invoiceUrl as string | undefined;
  const failureReason = payload.failureReason as string | undefined;

  if (!transactionId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "billing.webhook.missingTransactionId",
        },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  const paymentLookup = await db.query<
    [{ id: string; status: string }[]]
  >(
    `SELECT id, status FROM payment WHERE transactionId = $txId LIMIT 1`,
    { txId: transactionId },
  );

  const payment = paymentLookup[0]?.[0];
  if (!payment) {
    return Response.json({ success: true, action: "ignored" });
  }

  // Idempotency (§14.5): already resolved
  if (
    payment.status === "completed" ||
    payment.status === "failed" ||
    payment.status === "expired"
  ) {
    return Response.json({ success: true, action: "already_resolved" });
  }

  const success = providerStatus === "succeeded";

  await publish("resolve_async_payment", {
    paymentId: String(payment.id),
    transactionId,
    success,
    invoiceUrl: invoiceUrl ?? undefined,
    failureReason: failureReason ?? undefined,
  });

  return Response.json({ success: true, action: "queued" });
}
