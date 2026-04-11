import { getDb, rid } from "../connection.ts";
import type {
  CreditPurchase,
  PaymentMethod,
  Subscription,
} from "@/src/contracts/billing";

export async function getActiveSubscription(
  companyId: string,
  systemId: string,
): Promise<Subscription | null> {
  const db = await getDb();
  const result = await db.query<[Subscription[]]>(
    `SELECT * FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1`,
    { companyId, systemId },
  );
  return result[0]?.[0] ?? null;
}

export async function listPaymentMethods(
  companyId: string,
): Promise<PaymentMethod[]> {
  const db = await getDb();
  const result = await db.query<[PaymentMethod[]]>(
    "SELECT * FROM payment_method WHERE companyId = $companyId ORDER BY isDefault DESC, createdAt DESC FETCH billingAddress",
    { companyId },
  );
  return result[0] ?? [];
}

export async function createPaymentMethod(data: {
  companyId: string;
  cardMask: string;
  cardToken: string;
  holderName: string;
  holderDocument: string;
  billingAddress: Record<string, string>;
}): Promise<PaymentMethod> {
  const db = await getDb();
  const addr = data.billingAddress;

  const result = await db.query<[unknown, unknown, PaymentMethod[]]>(
    `LET $addr = CREATE address SET
      street = $street,
      number = $number,
      complement = $complement,
      neighborhood = $neighborhood,
      city = $city,
      state = $state,
      country = $country,
      postalCode = $postalCode;
    LET $pm = CREATE payment_method SET
      companyId = $companyId,
      type = "credit_card",
      cardMask = $cardMask,
      cardToken = $cardToken,
      holderName = $holderName,
      holderDocument = $holderDocument,
      billingAddress = $addr[0].id,
      isDefault = false;
    SELECT * FROM $pm[0].id FETCH billingAddress;`,
    {
      street: addr.street ?? "",
      number: addr.number ?? "",
      complement: addr.complement || undefined,
      neighborhood: addr.neighborhood || undefined,
      city: addr.city ?? "",
      state: addr.state ?? "",
      country: addr.country ?? "",
      postalCode: addr.postalCode ?? "",
      companyId: data.companyId,
      cardMask: data.cardMask,
      cardToken: data.cardToken,
      holderName: data.holderName,
      holderDocument: data.holderDocument,
    },
  );
  return result[2][0];
}

export async function setDefaultPaymentMethod(
  id: string,
  companyId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE payment_method SET isDefault = false WHERE companyId = $companyId;
    UPDATE $id SET isDefault = true;`,
    { companyId, id: rid(id) },
  );
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $pm = (SELECT billingAddress FROM $id);
    DELETE $id;
    IF $pm[0].billingAddress != NONE {
      DELETE $pm[0].billingAddress;
    };`,
    { id: rid(id) },
  );
}

export async function createCreditPurchase(data: {
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
}): Promise<CreditPurchase> {
  const db = await getDb();
  const result = await db.query<[CreditPurchase[]]>(
    `CREATE credit_purchase SET
      companyId = $companyId,
      systemId = $systemId,
      amount = $amount,
      paymentMethodId = $paymentMethodId,
      status = "pending"`,
    data,
  );
  return result[0][0];
}

export async function getDueSubscriptions(): Promise<Subscription[]> {
  const db = await getDb();
  const result = await db.query<[Subscription[]]>(
    `SELECT * FROM subscription
     WHERE status = "active" AND currentPeriodEnd <= time::now()`,
  );
  return result[0] ?? [];
}
