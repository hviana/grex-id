import type { Address } from "./address";

export interface IPaymentProvider {
  charge(
    amountCents: number,
    params: Record<string, string>,
  ): Promise<PaymentResult>;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface IClientPaymentProvider {
  tokenize(
    cardData: CardInput,
    billingAddress: Address,
  ): Promise<TokenizationResult>;
}

export interface CardInput {
  number: string;
  cvv: string;
  expiryMonth: string;
  expiryYear: string;
  holderName: string;
  holderDocument: string;
}

export interface TokenizationResult {
  cardToken: string;
  cardMask: string;
}
