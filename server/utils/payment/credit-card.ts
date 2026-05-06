import "server-only";

import type {
  IPaymentProvider,
  PaymentResult,
} from "@/src/contracts/high-level/payment-provider";

/**
 * Stub payment provider.
 *
 * Replace with a real gateway integration (e.g. Stripe, PagSeguro, MercadoPago).
 * The gateway credentials should be stored as settings and read via get().
 *
 * ⚠ This stub returns fake successful charges — do NOT use in production.
 */
export class CreditCardPaymentProvider implements IPaymentProvider {
  async charge(
    amountCents: number,
    params: Record<string, string>,
  ): Promise<PaymentResult> {
    console.warn(
      `[payment] STUB: would charge ${amountCents} cents. Replace with real gateway.`,
    );

    return {
      success: true,
      transactionId: crypto.randomUUID(),
    };
  }
}
