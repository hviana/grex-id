import { getDb, rid } from "../connection.ts";
import type {
  CreditPurchase,
  PaymentMethod,
  Subscription,
} from "@/src/contracts/billing";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("billing");

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
    "SELECT * FROM payment_method WHERE companyId = $companyId ORDER BY isDefault DESC, createdAt DESC FETCH billingAddressId",
    { companyId },
  );
  return result[0] ?? [];
}

// ─── GET billing data ────────────────────────────────────────────────────────

export interface BillingGetData {
  subscriptions: Record<string, unknown>[];
  paymentMethods: Record<string, unknown>[];
  creditPurchases: Record<string, unknown>[];
  creditsBalance: number;
  payments?: Record<string, unknown>[];
  paymentsNextCursor?: string | null;
  pendingAsyncPayments: Record<string, unknown>[];
}

export async function getBillingData(params: {
  companyId: string;
  systemId: string;
  startDate?: string;
  endDate?: string;
  paymentCursor?: string;
  includePayments: boolean;
}): Promise<BillingGetData> {
  const db = await getDb();

  const queryParams: Record<string, unknown> = {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
  };

  let paymentQuery = "";
  if (params.includePayments) {
    const whereClauses = [
      "companyId = $companyId",
      "systemId = $systemId",
    ];
    if (params.startDate) {
      whereClauses.push("createdAt >= $startDate");
      queryParams.startDate = new Date(params.startDate).toISOString();
    }
    if (params.endDate) {
      whereClauses.push("createdAt <= $endDate");
      queryParams.endDate = new Date(params.endDate).toISOString();
    }
    if (params.paymentCursor) {
      whereClauses.push("createdAt < $cursorDate");
      queryParams.cursorDate = new Date(
        atob(params.paymentCursor),
      ).toISOString();
    }
    const whereStr = whereClauses.join(" AND ");
    paymentQuery =
      `SELECT * FROM payment WHERE ${whereStr} ORDER BY createdAt DESC LIMIT 21;`;
  }

  const result = await db.query<
    [
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[]?,
      Record<string, unknown>[]?,
    ]
  >(
    `SELECT * FROM subscription WHERE companyId = $companyId AND systemId = $systemId ORDER BY createdAt DESC FETCH voucherId;
     SELECT * FROM payment_method WHERE companyId = $companyId ORDER BY isDefault DESC, createdAt DESC FETCH billingAddressId;
     SELECT * FROM credit_purchase WHERE companyId = $companyId AND systemId = $systemId ORDER BY createdAt DESC LIMIT 20;
     SELECT math::sum(value) AS balance FROM usage_record WHERE companyId = $companyId AND systemId = $systemId AND resource = "credits" GROUP ALL;
     ${paymentQuery}
     SELECT id, amount, currency, kind, continuityData, expiresAt, createdAt
       FROM payment
       WHERE companyId = $companyId
         AND systemId = $systemId
         AND status = "pending"
         AND continuityData IS NOT NONE
       ORDER BY createdAt DESC
       LIMIT 10;`,
    queryParams,
  );

  const responseData: BillingGetData = {
    subscriptions: result[0] ?? [],
    paymentMethods: result[1] ?? [],
    creditPurchases: result[2] ?? [],
    creditsBalance: Number(result[3]?.[0]?.balance ?? 0),
    pendingAsyncPayments: result[5] ?? [],
  };

  if (params.includePayments) {
    const paymentRows: Record<string, unknown>[] = result[4] ?? [];
    const hasMore = paymentRows.length > 20;
    const paymentData = hasMore ? paymentRows.slice(0, 20) : paymentRows;
    const lastRow = paymentData[paymentData.length - 1];
    responseData.payments = paymentData;
    responseData.paymentsNextCursor = hasMore && lastRow
      ? btoa(String(lastRow.createdAt))
      : null;
  }

  return responseData;
}

// ─── subscribe ───────────────────────────────────────────────────────────────

export async function subscribe(params: {
  companyId: string;
  systemId: string;
  planId: string;
  paymentMethodId: string | null;
  userId: string | null;
  planCredits: number;
  operationCountMap: Record<string, number> | null;
  start: Date;
  end: Date;
}): Promise<unknown> {
  const db = await getDb();

  const queryParams: Record<string, unknown> = {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    planId: rid(params.planId),
    planCredits: params.planCredits,
    operationCountMap: params.operationCountMap,
    start: params.start,
    end: params.end,
  };
  if (params.paymentMethodId) {
    queryParams.paymentMethodId = rid(params.paymentMethodId);
  }
  if (params.userId) {
    queryParams.userId = rid(params.userId);
  }

  const userClauses = params.userId
    ? `IF array::len((SELECT id FROM company_user WHERE userId = $userId AND companyId = $companyId)) = 0 {
         CREATE company_user SET userId = $userId, companyId = $companyId;
       };
       IF array::len((SELECT id FROM user_company_system WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId)) = 0 {
         LET $adminRoleId = (SELECT VALUE id FROM role WHERE name = "admin" AND systemId = $systemId LIMIT 1)[0];
         CREATE user_company_system SET userId = $userId, companyId = $companyId, systemId = $systemId, roleIds = [$adminRoleId];
       };`
    : "";

  return db.query(
    `IF array::len((SELECT id FROM company_system WHERE companyId = $companyId AND systemId = $systemId)) = 0 {
       CREATE company_system SET companyId = $companyId, systemId = $systemId;
     };
     UPDATE subscription SET status = "cancelled" WHERE companyId = $companyId AND systemId = $systemId AND status = "active";
     CREATE subscription SET
       companyId = $companyId,
       systemId = $systemId,
       planId = $planId,
       paymentMethodId = ${
      params.paymentMethodId ? "$paymentMethodId" : "NONE"
    },
       status = "active",
       currentPeriodStart = $start,
       currentPeriodEnd = $end,
       voucherId = NONE,
       remainingPlanCredits = $planCredits,
       remainingOperationCount = ${
      params.operationCountMap ? "$operationCountMap" : "NONE"
    },
       creditAlertSent = false,
       operationCountAlertSent = {},
       autoRechargeEnabled = false,
       autoRechargeAmount = 0,
       autoRechargeInProgress = false,
       retryPaymentInProgress = false;
     ${userClauses}`,
    queryParams,
  );
}

// ─── cancel ──────────────────────────────────────────────────────────────────

export async function cancelSubscription(
  companyId: string,
  systemId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE subscription SET status = "cancelled"
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );
}

// ─── add_payment_method ──────────────────────────────────────────────────────

export async function addPaymentMethod(data: {
  companyId: string;
  cardToken: string;
  cardMask: string;
  holderName: string;
  holderDocument: string;
  billingAddress: Record<string, string>;
}): Promise<Record<string, unknown> | undefined> {
  const db = await getDb();
  const addr = data.billingAddress;

  const result = await db.query<
    [unknown, unknown, unknown, Record<string, unknown>[]]
  >(
    `LET $addr = CREATE address SET
      street = $street,
      number = $number,
      complement = $complement,
      neighborhood = $neighborhood,
      city = $city,
      state = $state,
      country = $country,
      postalCode = $postalCode;
    LET $existingCount = (SELECT count() FROM payment_method WHERE companyId = $companyId GROUP ALL).count ?? 0;
    LET $pm = CREATE payment_method SET
      companyId = $companyId,
      type = "credit_card",
      cardMask = $cardMask,
      cardToken = $cardToken,
      holderName = $holderName,
      holderDocument = $holderDocument,
      billingAddressId = $addr[0].id,
      isDefault = IF $existingCount = 0 THEN true ELSE false END;
    SELECT * FROM $pm[0].id FETCH billingAddressId;`,
    {
      street: addr.street ?? "",
      number: addr.number ?? "",
      complement: addr.complement || undefined,
      neighborhood: addr.neighborhood || undefined,
      city: addr.city ?? "",
      state: addr.state ?? "",
      country: addr.country ?? "",
      postalCode: addr.postalCode ?? "",
      companyId: rid(data.companyId),
      cardMask: data.cardMask,
      cardToken: data.cardToken,
      holderName: data.holderName,
      holderDocument: data.holderDocument ?? "",
    },
  );

  return result[3]?.[0];
}

// ─── set_default_payment_method ──────────────────────────────────────────────

export async function setDefaultPaymentMethod(
  companyId: string,
  paymentMethodId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE payment_method SET isDefault = false WHERE companyId = $companyId;
     UPDATE $pmId SET isDefault = true;`,
    { companyId: rid(companyId), pmId: rid(paymentMethodId) },
  );
}

// ─── remove_payment_method ───────────────────────────────────────────────────

export async function removePaymentMethod(
  paymentMethodId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $pm = (SELECT billingAddressId, companyId, isDefault FROM $id);
     DELETE $id;
     IF $pm[0].billingAddressId != NONE {
       DELETE $pm[0].billingAddressId;
     };
     IF $pm[0].isDefault = true {
       LET $next = (SELECT id FROM payment_method WHERE companyId = $pm[0].companyId LIMIT 1);
       IF $next[0].id != NONE {
         UPDATE $next[0].id SET isDefault = true;
       };
     };`,
    { id: rid(paymentMethodId) },
  );
}

// ─── purchase_credits ────────────────────────────────────────────────────────

export interface PurchaseCreditsResult {
  purchase: Record<string, unknown>;
  activeSubscriptionId: string;
}

export async function purchaseCredits(params: {
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
}): Promise<PurchaseCreditsResult> {
  const db = await getDb();
  const result = await db.query<
    [Record<string, unknown>[], { id: string }[]]
  >(
    `LET $subId = (SELECT id FROM subscription
      WHERE companyId = $companyId AND systemId = $systemId AND status = "active" LIMIT 1)[0].id;
     CREATE credit_purchase SET
      companyId = $companyId,
      systemId = $systemId,
      amount = $amount,
      paymentMethodId = $paymentMethodId,
      subscriptionId = $subId,
      status = "pending";
     UPDATE subscription SET creditAlertSent = false
      WHERE companyId = $companyId AND systemId = $systemId AND status = "active";
     SELECT id FROM subscription
      WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
      LIMIT 1;`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      amount: params.amount,
      paymentMethodId: rid(params.paymentMethodId),
    },
  );

  const purchase = result[0]?.[0];
  const activeSubId = result[1]?.[0]?.id;

  return {
    purchase,
    activeSubscriptionId: String(activeSubId ?? ""),
  };
}

// ─── apply_voucher (lookup phase) ───────────────────────────────────────────

export interface VoucherLookupResult {
  voucher: Record<string, unknown> | undefined;
  subscription: {
    planId: string;
    voucherId: string | null;
    remainingOperationCount?: Record<string, number>;
  } | undefined;
  oldVoucher: {
    creditModifier: number;
    maxOperationCountModifier?: Record<string, number>;
  } | undefined;
}

export async function lookupVoucherAndSubscription(params: {
  voucherCode: string;
  companyId: string;
  systemId: string;
}): Promise<VoucherLookupResult> {
  const db = await getDb();
  const batchResult = await db.query<
    [
      Record<string, unknown>[],
      {
        planId: string;
        voucherId: string | null;
        remainingOperationCount?: Record<string, number>;
      }[],
      {
        creditModifier: number;
        maxOperationCountModifier?: Record<string, number>;
      }[],
    ]
  >(
    `SELECT * FROM voucher WHERE code = $code LIMIT 1;
     SELECT planId, voucherId, remainingOperationCount FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1;
     LET $oldVoucherId = (SELECT VALUE voucherId FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1)[0];
     IF $oldVoucherId != NONE {
       SELECT creditModifier, maxOperationCountModifier FROM voucher WHERE id = $oldVoucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };`,
    {
      code: params.voucherCode,
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
    },
  );

  return {
    voucher: batchResult[0]?.[0],
    subscription: batchResult[1]?.[0],
    oldVoucher: batchResult[2]?.[0],
  };
}

// ─── apply_voucher (update phase) ───────────────────────────────────────────

export async function applyVoucherToSubscription(params: {
  companyId: string;
  systemId: string;
  voucherId: string;
  creditDelta: number;
  opCountNewValues?: Record<string, number>;
  alertResets?: Record<string, boolean>;
}): Promise<void> {
  const db = await getDb();

  const { creditDelta, opCountNewValues, alertResets } = params;

  const creditClause = creditDelta !== 0
    ? ", remainingPlanCredits = remainingPlanCredits + $creditDelta"
    : "";

  const hasOpCountChanges = opCountNewValues &&
    Object.keys(opCountNewValues).length > 0;
  const opCountMergeClause = hasOpCountChanges
    ? ", remainingOperationCount = object::extend(remainingOperationCount ?? {}, $opCountNewValues), operationCountAlertSent = object::extend(operationCountAlertSent ?? {}, $alertResets)"
    : "";

  const updateQuery = creditClause || opCountMergeClause
    ? `UPDATE subscription SET voucherId = $voucherId${creditClause}${opCountMergeClause}
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`
    : `UPDATE subscription SET voucherId = $voucherId
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`;

  await db.query(updateQuery, {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    voucherId: rid(params.voucherId),
    ...(creditDelta !== 0 ? { creditDelta } : {}),
    ...(hasOpCountChanges ? { opCountNewValues, alertResets } : {}),
  });
}

// ─── set_auto_recharge (enable) ─────────────────────────────────────────────

export interface EnableAutoRechargeResult {
  hasDefaultPaymentMethod: boolean;
}

export async function enableAutoRecharge(params: {
  companyId: string;
  systemId: string;
  amount: number;
}): Promise<EnableAutoRechargeResult> {
  const db = await getDb();
  const pmResult = await db.query<
    [{ id: string }[], unknown[]]
  >(
    `LET $pm = (SELECT id FROM payment_method WHERE companyId = $companyId AND isDefault = true LIMIT 1);
     IF array::len($pm) > 0 {
       UPDATE subscription SET
         autoRechargeEnabled = true,
         autoRechargeAmount = $amount
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active";
     };
     RETURN $pm;`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      amount: params.amount,
    },
  );

  const pm = pmResult[1];
  const hasDefault = pm &&
    !(
      (Array.isArray(pm) && pm.length === 0) ||
      (pm as any)[0]?.id === undefined
    );

  return { hasDefaultPaymentMethod: !!hasDefault };
}

// ─── set_auto_recharge (disable) ────────────────────────────────────────────

export async function disableAutoRecharge(
  companyId: string,
  systemId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE subscription SET
      autoRechargeEnabled = false,
      autoRechargeAmount = 0,
      autoRechargeInProgress = false
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );
}

// ─── retry_payment ───────────────────────────────────────────────────────────

export interface RetryPaymentResult {
  status: "not_found" | "conflict" | "ok";
  subscriptionId?: string;
}

export async function retryPayment(
  companyId: string,
  systemId: string,
): Promise<RetryPaymentResult> {
  const db = await getDb();
  const retryResult = await db.query<
    [{ result: string; id?: string }[]]
  >(
    `LET $sub = (SELECT id, retryPaymentInProgress FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "past_due"
       LIMIT 1);
     IF array::len($sub) = 0 {
       RETURN [{ result: "not_found" }];
     } ELSE IF $sub[0].retryPaymentInProgress = true {
       RETURN [{ result: "conflict" }];
     } ELSE {
       UPDATE $sub[0].id SET retryPaymentInProgress = true;
       RETURN [{ result: "ok", id: $sub[0].id }];
     };`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );

  const retryRow = retryResult[0]?.[0];
  if (!retryRow || retryRow.result === "not_found") {
    return { status: "not_found" };
  }
  if (retryRow.result === "conflict") {
    return { status: "conflict" };
  }
  return { status: "ok", subscriptionId: String(retryRow.id) };
}

// ─── createPaymentMethod (used by other routes) ─────────────────────────────

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
      billingAddressId = $addr[0].id,
      isDefault = false;
    SELECT * FROM $pm[0].id FETCH billingAddressId;`,
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

// ─── setDefaultPaymentMethodById (used by other routes) ──────────────────────

export async function setDefaultPaymentMethodById(
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

// ─── deletePaymentMethod (used by other routes) ──────────────────────────────

export async function deletePaymentMethod(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $pm = (SELECT billingAddressId FROM $id);
    DELETE $id;
    IF $pm[0].billingAddressId != NONE {
      DELETE $pm[0].billingAddressId;
    };`,
    { id: rid(id) },
  );
}

// ─── createCreditPurchase (used by other routes) ─────────────────────────────

export async function createCreditPurchase(data: {
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
  subscriptionId?: string;
}): Promise<CreditPurchase> {
  const db = await getDb();
  const result = await db.query<[CreditPurchase[]]>(
    `CREATE credit_purchase SET
      companyId = $companyId,
      systemId = $systemId,
      amount = $amount,
      paymentMethodId = $paymentMethodId,
      subscriptionId = $subscriptionId,
      status = "pending"`,
    {
      ...data,
      subscriptionId: data.subscriptionId
        ? rid(data.subscriptionId)
        : undefined,
    },
  );
  return result[0][0];
}

// ─── getDueSubscriptions (used by recurring billing job) ─────────────────────

export async function getDueSubscriptions(): Promise<Subscription[]> {
  const db = await getDb();
  const result = await db.query<[Subscription[]]>(
    `SELECT * FROM subscription
     WHERE status = "active" AND currentPeriodEnd <= time::now()`,
  );
  return result[0] ?? [];
}

// ─── findPaymentByTransactionId (used by webhook) ────────────────────────────

export async function findPaymentByTransactionId(
  transactionId: string,
): Promise<{ id: string; status: string } | null> {
  const db = await getDb();
  const result = await db.query<[{ id: string; status: string }[]]>(
    `SELECT id, status FROM payment WHERE transactionId = $txId LIMIT 1`,
    { txId: transactionId },
  );
  return result[0]?.[0] ?? null;
}

// ─── Expire pending payments (used by expire-pending-payments job) ─────────

export interface ExpiredPaymentRow {
  id: string;
  companyId: string;
  systemId: string;
  subscriptionId: string;
  kind: string;
  amount: number;
  currency: string;
}

export async function markExpiredPayments(): Promise<ExpiredPaymentRow[]> {
  const db = await getDb();
  const expired = await db.query<[ExpiredPaymentRow[]]>(
    `UPDATE payment SET status = "expired"
     WHERE status = "pending"
       AND expiresAt IS NOT NONE
       AND expiresAt <= time::now()
     RETURN id, companyId, systemId, subscriptionId, kind, amount, currency;`,
  );
  return expired[0] ?? [];
}

export interface ExpiredPaymentOwnerInfo {
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
}

export async function resolveExpiredPaymentContext(params: {
  companyId: string;
  systemId: string;
  subscriptionId: string;
}): Promise<ExpiredPaymentOwnerInfo> {
  const db = await getDb();
  const result = await db.query<
    [{ id: string; name: string }[], { name: string; slug: string }[]]
  >(
    `LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profileId.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;
     UPDATE credit_purchase SET status = "expired"
       WHERE subscriptionId = $subId AND status = "pending";
     UPDATE $subId SET
      retryPaymentInProgress = false,
      autoRechargeInProgress = false;`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      subId: rid(params.subscriptionId),
    },
  );

  return {
    owner: result[0]?.[0],
    systemInfo: result[1]?.[0],
  };
}

// ─── process-payment handler queries ─────────────────────────────────────────

export interface PaymentSubscriptionContext {
  sub: {
    id: string;
    planId: string;
    paymentMethodId: string;
    companyId: string;
    systemId: string;
    status: string;
    currentPeriodEnd: string;
    voucherId: string | null;
  } | undefined;
  plan: {
    price: number;
    recurrenceDays: number;
    planCredits: number;
    currency: string;
  } | undefined;
  voucher: { priceModifier: number; creditModifier: number } | undefined;
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
  purchaseStatus: string | undefined;
}

export async function getPaymentSubscriptionContext(params: {
  subscriptionId: string;
  creditPurchaseId?: string;
}): Promise<PaymentSubscriptionContext> {
  const db = await getDb();
  const creditPurchaseQuery = params.creditPurchaseId
    ? `SELECT status FROM credit_purchase WHERE id = $purchaseId LIMIT 1;`
    : `SELECT NONE FROM NONE;`;

  const result = await db.query<
    [
      {
        id: string;
        planId: string;
        paymentMethodId: string;
        companyId: string;
        systemId: string;
        status: string;
        currentPeriodEnd: string;
        voucherId: string | null;
      }[],
      {
        price: number;
        recurrenceDays: number;
        planCredits: number;
        currency: string;
      }[],
      { priceModifier: number; creditModifier: number }[],
      { id: string; name: string }[],
      { name: string; slug: string }[],
      { status?: string }[],
    ]
  >(
    `SELECT * FROM subscription WHERE id = $id LIMIT 1;
     LET $planId = (SELECT VALUE planId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT price, recurrenceDays, planCredits, currency FROM plan WHERE id = $planId LIMIT 1;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription WHERE id = $id LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT priceModifier, creditModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     LET $companyId = (SELECT VALUE companyId FROM subscription WHERE id = $id LIMIT 1)[0];
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profileId.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     LET $systemId = (SELECT VALUE systemId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;
     ${creditPurchaseQuery}`,
    {
      id: rid(params.subscriptionId),
      purchaseId: params.creditPurchaseId
        ? rid(params.creditPurchaseId)
        : undefined,
    },
  );

  return {
    sub: result[0]?.[0],
    plan: result[1]?.[0],
    voucher: result[2]?.[0],
    owner: result[3]?.[0],
    systemInfo: result[4]?.[0],
    purchaseStatus: result[5]?.[0]?.status,
  };
}

export async function createPaymentRecord(params: {
  companyId: string;
  systemId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  kind: string;
  paymentMethodId: string;
}): Promise<string | undefined> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `CREATE payment SET
      companyId = $companyId,
      systemId = $systemId,
      subscriptionId = $subId,
      amount = $amount,
      currency = $currency,
      kind = $kind,
      status = "pending",
      paymentMethodId = $pmId`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      subId: rid(params.subscriptionId),
      amount: params.amount,
      currency: params.currency,
      kind: params.kind,
      pmId: rid(params.paymentMethodId),
    },
  );
  return result[0]?.[0]?.id;
}

export async function updatePaymentAsyncData(params: {
  paymentId: string;
  continuityData: Record<string, unknown>;
  expiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $paymentId SET
      continuityData = $continuityData,
      expiresAt = $expiresAt
     WHERE id = $paymentId;`,
    {
      paymentId: rid(params.paymentId),
      continuityData: params.continuityData,
      expiresAt: params.expiresAt,
    },
  );
}

export async function renewSubscriptionOnSuccess(params: {
  subscriptionId: string;
  isRetry: boolean;
  newStart: Date;
  newEnd: Date;
  remainingPlanCredits: number;
  remainingOperationCount: Record<string, number> | null;
  paymentId?: string;
  transactionId?: string;
  invoiceUrl?: string;
}): Promise<void> {
  const db = await getDb();
  const statusClause = params.isRetry
    ? `status = "active", retryPaymentInProgress = false,`
    : `retryPaymentInProgress = false,`;
  const paymentStmt = params.paymentId
    ? `UPDATE $paymentId SET status = "completed", transactionId = $txId, invoiceUrl = $invoiceUrl;`
    : "";

  await db.query(
    `UPDATE $id SET
      ${statusClause}
      currentPeriodStart = $newStart,
      currentPeriodEnd = $newEnd,
      remainingPlanCredits = $remainingPlanCredits,
      remainingOperationCount = $remainingOperationCount,
      creditAlertSent = false,
      operationCountAlertSent = {};
     ${paymentStmt}`,
    {
      id: rid(params.subscriptionId),
      newStart: params.newStart,
      newEnd: params.newEnd,
      remainingPlanCredits: params.remainingPlanCredits,
      remainingOperationCount: params.remainingOperationCount,
      paymentId: params.paymentId ? rid(params.paymentId) : undefined,
      txId: params.transactionId,
      invoiceUrl: params.invoiceUrl,
    },
  );
}

export async function creditPurchaseOnSuccess(params: {
  companyId: string;
  systemId: string;
  amount: number;
  period: string;
  subscriptionId: string;
  creditPurchaseId?: string;
  isAutoRecharge?: boolean;
  paymentId?: string;
  transactionId?: string;
  invoiceUrl?: string;
  actorId?: string;
}): Promise<void> {
  const db = await getDb();
  const actorIdClause = params.actorId
    ? `actorType = "api_token", actorId = $actorId,`
    : "";
  const stmts = [
    `UPSERT usage_record SET
      ${actorIdClause}
      companyId = $companyId, systemId = $systemId,
      resource = "credits", value += $amount, period = $period
     WHERE companyId = $companyId AND systemId = $systemId
       AND resource = "credits";`,
  ];
  const queryParams: Record<string, unknown> = {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    amount: params.amount,
    period: params.period,
    subId: rid(params.subscriptionId),
  };

  if (params.actorId) {
    queryParams.actorId = params.actorId;
  }

  if (params.creditPurchaseId) {
    stmts.push(`UPDATE $purchaseId SET status = "completed";`);
    queryParams.purchaseId = rid(params.creditPurchaseId);
  }
  if (params.isAutoRecharge) {
    stmts.push(`UPDATE $subId SET autoRechargeInProgress = false;`);
  }
  stmts.push(`UPDATE $subId SET creditAlertSent = false;`);

  if (params.paymentId) {
    stmts.push(
      `UPDATE $paymentId SET status = "completed", transactionId = $txId, invoiceUrl = $invoiceUrl;`,
    );
    queryParams.paymentId = rid(params.paymentId);
    queryParams.txId = params.transactionId;
    queryParams.invoiceUrl = params.invoiceUrl;
  }

  await db.query(stmts.join("\n"), queryParams);
}

export async function paymentOnFailure(params: {
  subscriptionId: string;
  isRecurring: boolean;
  isRetry: boolean;
  isAutoRecharge?: boolean;
  creditPurchaseId?: string;
  paymentId?: string;
  failureReason: string;
}): Promise<void> {
  const db = await getDb();
  const stmts: string[] = [];
  const queryParams: Record<string, unknown> = {
    subId: rid(params.subscriptionId),
  };

  const subSets: string[] = [];
  if (params.isRecurring) subSets.push(`status = "past_due"`);
  if (params.isRetry || params.isRecurring) {
    subSets.push(`retryPaymentInProgress = false`);
  }
  if (params.isAutoRecharge) subSets.push(`autoRechargeInProgress = false`);
  if (subSets.length > 0) {
    stmts.push(`UPDATE $subId SET ${subSets.join(", ")};`);
  }

  if (params.creditPurchaseId) {
    stmts.push(`UPDATE $purchaseId SET status = "failed";`);
    queryParams.purchaseId = rid(params.creditPurchaseId);
  }
  if (params.paymentId) {
    stmts.push(
      `UPDATE $paymentId SET status = "failed", failureReason = $reason;`,
    );
    queryParams.paymentId = rid(params.paymentId);
    queryParams.reason = params.failureReason;
  }

  if (stmts.length > 0) {
    await db.query(stmts.join("\n"), queryParams);
  }
}

// ─── resolve-async-payment handler queries ───────────────────────────────────

export interface AsyncPaymentContext {
  payment: {
    id: string;
    status: string;
    subscriptionId: string;
    companyId: string;
    systemId: string;
    amount: number;
    currency: string;
    kind: string;
  } | undefined;
  sub: {
    id: string;
    planId: string;
    paymentMethodId: string;
    status: string;
    currentPeriodEnd: string;
  } | undefined;
  plan: {
    price: number;
    recurrenceDays: number;
    planCredits: number;
    currency: string;
  } | undefined;
  voucher: { priceModifier: number; creditModifier: number } | undefined;
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
  creditPurchase: { status?: string } | undefined;
}

export async function getAsyncPaymentContext(
  paymentId: string,
): Promise<AsyncPaymentContext> {
  const db = await getDb();
  const result = await db.query<
    [
      {
        id: string;
        status: string;
        subscriptionId: string;
        companyId: string;
        systemId: string;
        amount: number;
        currency: string;
        kind: string;
      }[],
      {
        id: string;
        planId: string;
        paymentMethodId: string;
        status: string;
        currentPeriodEnd: string;
      }[],
      {
        price: number;
        recurrenceDays: number;
        planCredits: number;
        currency: string;
      }[],
      { priceModifier: number; creditModifier: number }[],
      { id: string; name: string }[],
      { name: string; slug: string }[],
      { status?: string }[],
    ]
  >(
    `SELECT id, status, subscriptionId, companyId, systemId, amount, currency, kind FROM payment WHERE id = $id LIMIT 1;
     LET $subId = (SELECT VALUE subscriptionId FROM payment WHERE id = $id LIMIT 1)[0];
     SELECT id, planId, paymentMethodId, status, currentPeriodEnd FROM subscription WHERE id = $subId LIMIT 1;
     LET $planId = (SELECT VALUE planId FROM subscription WHERE id = $subId LIMIT 1)[0];
     SELECT price, recurrenceDays, planCredits, currency FROM plan WHERE id = $planId LIMIT 1;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription WHERE id = $subId LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT priceModifier, creditModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     LET $companyId = (SELECT VALUE companyId FROM payment WHERE id = $id LIMIT 1)[0];
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profileId.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     LET $systemId = (SELECT VALUE systemId FROM payment WHERE id = $id LIMIT 1)[0];
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;
     SELECT status FROM credit_purchase WHERE subscriptionId = $subId AND status = "pending" LIMIT 1;`,
    { id: rid(paymentId) },
  );

  return {
    payment: result[0]?.[0],
    sub: result[1]?.[0],
    plan: result[2]?.[0],
    voucher: result[3]?.[0],
    owner: result[4]?.[0],
    systemInfo: result[5]?.[0],
    creditPurchase: result[6]?.[0],
  };
}

export async function resolveAsyncRecurringSuccess(params: {
  subscriptionId: string;
  paymentId: string;
  newStart: Date;
  newEnd: Date;
  remainingPlanCredits: number;
  remainingOperationCount: Record<string, number> | null;
  hasPendingCreditPurchase: boolean;
  transactionId?: string;
  invoiceUrl?: string;
}): Promise<void> {
  const db = await getDb();
  const creditPurchaseStmt = params.hasPendingCreditPurchase
    ? `UPDATE credit_purchase SET status = "completed" WHERE subscriptionId = $subId AND status = "pending";`
    : "";

  await db.query(
    `UPDATE $subId SET
      status = "active",
      retryPaymentInProgress = false,
      currentPeriodStart = $newStart,
      currentPeriodEnd = $newEnd,
      remainingPlanCredits = $remainingPlanCredits,
      remainingOperationCount = $remainingOperationCount,
      creditAlertSent = false,
      operationCountAlertSent = {};
     UPDATE $paymentId SET
      status = "completed",
      transactionId = $txId,
      invoiceUrl = $invoiceUrl;
     ${creditPurchaseStmt}`,
    {
      subId: rid(params.subscriptionId),
      paymentId: rid(params.paymentId),
      newStart: params.newStart,
      newEnd: params.newEnd,
      remainingPlanCredits: params.remainingPlanCredits,
      remainingOperationCount: params.remainingOperationCount,
      txId: params.transactionId,
      invoiceUrl: params.invoiceUrl,
    },
  );
}

export async function resolveAsyncCreditSuccess(params: {
  companyId: string;
  systemId: string;
  amount: number;
  period: string;
  subscriptionId: string | undefined;
  paymentId: string;
  hasPendingCreditPurchase: boolean;
  isAutoRecharge: boolean;
  transactionId?: string;
  invoiceUrl?: string;
  actorId?: string;
}): Promise<void> {
  const db = await getDb();
  const actorIdClause = params.actorId
    ? `actorType = "api_token", actorId = $actorId,`
    : "";
  const stmts = [
    `UPSERT usage_record SET
      ${actorIdClause}
      companyId = $companyId, systemId = $systemId,
      resource = "credits", value += $amount, period = $period
     WHERE companyId = $companyId AND systemId = $systemId
       AND resource = "credits";`,
  ];
  const queryParams: Record<string, unknown> = {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    amount: params.amount,
    period: params.period,
    subId: params.subscriptionId ? rid(params.subscriptionId) : undefined,
    paymentId: rid(params.paymentId),
    txId: params.transactionId,
    invoiceUrl: params.invoiceUrl,
  };

  if (params.actorId) {
    queryParams.actorId = params.actorId;
  }

  if (params.hasPendingCreditPurchase && params.subscriptionId) {
    stmts.push(
      `UPDATE credit_purchase SET status = "completed" WHERE subscriptionId = $subId AND status = "pending";`,
    );
  }
  if (params.isAutoRecharge && params.subscriptionId) {
    stmts.push(`UPDATE $subId SET autoRechargeInProgress = false;`);
  }
  if (params.subscriptionId) {
    stmts.push(`UPDATE $subId SET creditAlertSent = false;`);
  }
  stmts.push(
    `UPDATE $paymentId SET status = "completed", transactionId = $txId, invoiceUrl = $invoiceUrl;`,
  );

  await db.query(stmts.join("\n"), queryParams);
}

export async function resolveAsyncPaymentFailure(params: {
  subscriptionId: string | undefined;
  paymentId: string;
  isRecurring: boolean;
  isAutoRecharge: boolean;
  hasPendingCreditPurchase: boolean;
  failureReason: string;
}): Promise<void> {
  const db = await getDb();
  const stmts: string[] = [];
  const queryParams: Record<string, unknown> = {
    subId: params.subscriptionId ? rid(params.subscriptionId) : undefined,
    paymentId: rid(params.paymentId),
  };

  const subSets: string[] = [];
  if (params.isRecurring) subSets.push(`status = "past_due"`);
  subSets.push(`retryPaymentInProgress = false`);
  if (params.isAutoRecharge) subSets.push(`autoRechargeInProgress = false`);
  if (subSets.length > 0 && params.subscriptionId) {
    stmts.push(`UPDATE $subId SET ${subSets.join(", ")};`);
  }

  if (params.hasPendingCreditPurchase) {
    stmts.push(
      `UPDATE credit_purchase SET status = "failed" WHERE subscriptionId = $subId AND status = "pending";`,
    );
  }

  stmts.push(
    `UPDATE $paymentId SET status = "failed", failureReason = $reason;`,
  );
  queryParams.reason = params.failureReason;

  await db.query(stmts.join("\n"), queryParams);
}

// ─── auto-recharge handler queries ───────────────────────────────────────────

export interface AutoRechargeContext {
  sub: {
    id: string;
    autoRechargeEnabled: boolean;
    autoRechargeAmount: number;
    autoRechargeInProgress: boolean;
    companyId: string;
    systemId: string;
  } | undefined;
  paymentMethod: { id: string } | undefined;
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
}

export async function getAutoRechargeContext(
  subscriptionId: string,
): Promise<AutoRechargeContext> {
  const db = await getDb();
  const result = await db.query<
    [
      {
        id: string;
        autoRechargeEnabled: boolean;
        autoRechargeAmount: number;
        autoRechargeInProgress: boolean;
        companyId: string;
        systemId: string;
      }[],
      { id: string }[],
      { id: string; name: string }[],
      { name: string; slug: string }[],
    ]
  >(
    `SELECT id, autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId
     FROM subscription WHERE id = $subId LIMIT 1;
     SELECT id FROM payment_method
       WHERE companyId = (SELECT VALUE companyId FROM subscription WHERE id = $subId LIMIT 1)[0]
       AND isDefault = true LIMIT 1;
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = (SELECT VALUE companyId FROM subscription WHERE id = $subId LIMIT 1)[0] LIMIT 1)[0];
     SELECT id, profileId.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     SELECT name, slug FROM system WHERE id = (SELECT VALUE systemId FROM subscription WHERE id = $subId LIMIT 1)[0] LIMIT 1;`,
    { subId: rid(subscriptionId) },
  );

  return {
    sub: result[0]?.[0],
    paymentMethod: result[1]?.[0],
    owner: result[2]?.[0],
    systemInfo: result[3]?.[0],
  };
}

export async function clearAutoRechargeFlag(
  subscriptionId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $subId SET autoRechargeInProgress = false`,
    { subId: rid(subscriptionId) },
  );
}

export async function createAutoRechargePurchase(params: {
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
  subscriptionId: string;
}): Promise<string> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `CREATE credit_purchase SET
       companyId = $companyId,
       systemId = $systemId,
       amount = $amount,
       paymentMethodId = $paymentMethodId,
       subscriptionId = $subscriptionId,
       status = "pending"`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      amount: params.amount,
      paymentMethodId: rid(params.paymentMethodId),
      subscriptionId: rid(params.subscriptionId),
    },
  );
  return String(result[0]?.[0]?.id ?? "");
}
