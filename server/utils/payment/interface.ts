import type {
  IPaymentProvider,
  PaymentResult,
} from "@/src/contracts/payment-provider";
import { assertServerOnly } from "../server-only.ts";

assertServerOnly("interface");

export type { IPaymentProvider, PaymentResult };
