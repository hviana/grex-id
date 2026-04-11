import type { IPaymentProvider, PaymentResult } from "./interface";

export class CreditCardPaymentProvider implements IPaymentProvider {
  async charge(
    amountCents: number,
    params: Record<string, string>,
  ): Promise<PaymentResult> {
    // TODO: Implement with actual payment gateway (Stripe, etc.)
    // Configured via core_setting "payment.provider"
    console.log(`[payment] Charging ${amountCents} cents with params:`, params);

    return {
      success: true,
      transactionId: crypto.randomUUID(),
    };
  }
}
