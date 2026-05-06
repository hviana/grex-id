import type { AddressInput } from "./component-props";

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
  invoiceUrl?: string;
  expiresInSeconds?: number;
  continuityData?: Record<string, any>;
}

export interface IClientPaymentProvider {
  tokenize(
    cardData: CardInput,
    billingAddress: AddressInput,
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
