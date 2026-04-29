export type {
  IPaymentProvider,
  PaymentResult,
} from "@/src/contracts/high-level/payment-provider";

import { assertServerOnly } from "../server-only.ts";

assertServerOnly("interface");
