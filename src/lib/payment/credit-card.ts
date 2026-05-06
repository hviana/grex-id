import type {
  CardInput,
  IClientPaymentProvider,
  TokenizationResult,
} from "@/src/contracts/high-level/payment-provider";
import type { AddressInput } from "@/src/contracts/high-level/component-props";

export class CreditCardTokenizer implements IClientPaymentProvider {
  async tokenize(
    cardData: CardInput,
    _billingAddress: AddressInput,
  ): Promise<TokenizationResult> {
    // TODO: Implement with actual payment gateway's client-side SDK
    // This is a placeholder that generates a mock token
    const last4 = cardData.number.replace(/\s/g, "").slice(-4);
    const cardToken = crypto.randomUUID();
    const cardMask = `**** **** **** ${last4}`;

    return { cardToken, cardMask };
  }
}
