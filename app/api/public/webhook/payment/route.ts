import { publish } from "@/server/event-queue/publisher";
import { findPaymentByTransactionId } from "@/server/db/queries/billing";

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

  const payment = await findPaymentByTransactionId(transactionId);

  if (!payment) {
    return Response.json({ success: true, action: "ignored" });
  }

  // Idempotency (§7.6): already resolved
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
