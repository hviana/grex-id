import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("credits");

/**
 * Fetches the active subscription with auto-recharge guard,
 * and the purchased credit balance, in a single batched query.
 *
 * The subscription is scoped by tenantIds (the company-system tenant rows).
 */
export async function fetchSubscriptionAndCreditBalance(params: {
  tenantId: string;
}): Promise<
  [
    {
      id: string;
      remainingPlanCredits: number;
      remainingOperationCount: Record<string, number> | null;
      creditAlertSent: boolean;
      operationCountAlertSent: Record<string, boolean> | null;
      autoRechargeEnabled: boolean;
      autoRechargeAmount: number;
      autoRechargeInProgress: boolean;
      tenantIds: string;
      autoRechargeGuardSet: boolean;
    }[],
    { balance: number }[],
  ]
> {
  const db = await getDb();
  return db.query(
    `LET $sub = (SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            tenantIds
     FROM subscription
     WHERE tenantIds CONTAINS $tenantId AND status = "active"
     LIMIT 1)[0];
     IF $sub != NONE AND $sub.autoRechargeEnabled = true AND $sub.autoRechargeInProgress = false {
       UPDATE $sub.id SET autoRechargeInProgress = true;
     };
     SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            tenantIds,
            (IF autoRechargeEnabled = true AND autoRechargeInProgress = false THEN true ELSE false END) AS autoRechargeGuardSet
     FROM subscription
     WHERE tenantIds CONTAINS $tenantId AND status = "active"
     LIMIT 1;
     SELECT math::sum(value) AS balance FROM usage_record
     WHERE tenantIds CONTAINS $tenantId AND resourceKey = "credits"
     GROUP ALL;`,
    {
      tenantId: rid(params.tenantId),
    },
  );
}

/**
 * Sets creditAlertSent=true on the subscription and fetches company owner + system info
 * for the insufficient-credit alert notification.
 *
 * Resolves owner via the tenant row: subscription.tenantIds -> tenant.companyId -> owner.
 */
export async function setCreditAlertAndFetchOwner(params: {
  subId: string;
  tenantId: string;
}): Promise<
  [
    unknown[],
    { name: string; ownerId: string }[],
    { id: string; name: string; locale: string }[],
    { name: string; slug: string }[],
  ]
> {
  const db = await getDb();
  return db.query(
    `UPDATE $subId SET creditAlertSent = true;
     LET $companyId = (SELECT VALUE companyId FROM tenant WHERE id = $tenantId LIMIT 1)[0];
     LET $systemId = (SELECT VALUE systemId FROM tenant WHERE id = $tenantId LIMIT 1)[0];
     SELECT name, ownerId FROM company WHERE id = $companyId LIMIT 1;
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profileId.name AS name, profileId.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      subId: rid(params.subId),
      tenantId: rid(params.tenantId),
    },
  );
}

/**
 * Deducts from plan credits only (plan credits >= amount).
 * Also records the credit expense and decrements operation count if applicable.
 */
export async function deductFromPlanCredits(params: {
  subId: string;
  amount: number;
  tenantId: string;
  resourceKey: string;
  day: string;
  actorId: string | null;
  opCountMerge: Record<string, number> | null;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $subId SET remainingPlanCredits -= $amount${
      params.opCountMerge
        ? ", remainingOperationCount = object::extend(remainingOperationCount ?? {}, $opCountMerge)"
        : ""
    };
     UPSERT credit_expense SET
       tenantIds = [$tenantId],
       resourceKey = $resourceKey, amount += $amount, count += 1, day = $day,
       actorId = $actorId
     WHERE tenantIds CONTAINS $tenantId
       AND resourceKey = $resourceKey AND day = $day;`,
    {
      subId: rid(params.subId),
      amount: params.amount,
      tenantId: rid(params.tenantId),
      resourceKey: params.resourceKey,
      day: params.day,
      actorId: params.actorId,
      ...(params.opCountMerge ? { opCountMerge: params.opCountMerge } : {}),
    },
  );
}

/**
 * Splits deduction: zeroes out plan credits, deducts remainder from purchased credits.
 * Also records the credit expense and decrements operation count if applicable.
 */
export async function deductFromPurchasedCredits(params: {
  subId: string;
  tenantId: string;
  fromPurchased: number;
  totalAmount: number;
  resourceKey: string;
  day: string;
  actorId: string | null;
  period: string;
  opCountMerge: Record<string, number> | null;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $subId SET remainingPlanCredits = 0${
      params.opCountMerge
        ? ", remainingOperationCount = object::extend(remainingOperationCount ?? {}, $opCountMerge)"
        : ""
    };
     UPSERT usage_record SET
       tenantIds = [$tenantId],
       resourceKey = "credits", value -= $fromPurchased, period = $period
     WHERE tenantIds CONTAINS $tenantId
       AND resourceKey = "credits";
     UPSERT credit_expense SET
       tenantIds = [$tenantId],
       resourceKey = $resourceKey, amount += $totalAmount, count += 1, day = $day,
       actorId = $actorId
     WHERE tenantIds CONTAINS $tenantId
       AND resourceKey = $resourceKey AND day = $day;`,
    {
      subId: rid(params.subId),
      tenantId: rid(params.tenantId),
      fromPurchased: params.fromPurchased,
      totalAmount: params.totalAmount,
      resourceKey: params.resourceKey,
      day: params.day,
      actorId: params.actorId,
      period: params.period,
      ...(params.opCountMerge ? { opCountMerge: params.opCountMerge } : {}),
    },
  );
}

/**
 * Checks the actor-level per-resourceKey operation count cap.
 * Returns the actor's maxOperationCountByResourceKey map and their current expense count.
 */
export async function fetchActorOperationCap(params: {
  actorRid: ReturnType<typeof rid>;
  actorStr: string;
  resourceKey: string;
  tenantId: ReturnType<typeof rid>;
  periodStart: string;
}): Promise<
  [
    (Record<string, number> | null)[],
    { count: number }[],
  ]
> {
  const db = await getDb();
  // All api_token actors (including actorType="app") live in api_token table.
  return db.query(
    `SELECT VALUE maxOperationCountByResourceKey FROM api_token WHERE id = $actorRid LIMIT 1;
     SELECT math::sum(count) AS count FROM credit_expense
     WHERE actorId = $actorStr
       AND resourceKey = $resourceKey
       AND tenantIds CONTAINS $tenantId
       AND day >= $periodStart
     GROUP ALL;`,
    {
      actorRid: params.actorRid,
      actorStr: params.actorStr,
      resourceKey: params.resourceKey,
      tenantId: params.tenantId,
      periodStart: params.periodStart,
    },
  );
}

/**
 * Sets the operation-count alert flag on the subscription and fetches
 * company owner + system info for the notification.
 *
 * Resolves owner via the tenant row: subscription.tenantIds -> tenant.companyId -> owner.
 */
export async function setOperationCountAlertAndFetchOwner(params: {
  subId: string;
  tenantId: string;
  alertMerge: Record<string, boolean>;
}): Promise<
  [
    unknown[],
    { id: string; name: string; locale: string }[],
    { name: string; slug: string }[],
  ]
> {
  const db = await getDb();
  return db.query(
    `UPDATE $subId SET operationCountAlertSent = object::extend(IF operationCountAlertSent IS NONE OR operationCountAlertSent = false THEN {} ELSE operationCountAlertSent END, $alertMerge);
     LET $companyId = (SELECT VALUE companyId FROM tenant WHERE id = $tenantId LIMIT 1)[0];
     LET $systemId = (SELECT VALUE systemId FROM tenant WHERE id = $tenantId LIMIT 1)[0];
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profileId.name AS name, profileId.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      subId: rid(params.subId),
      tenantId: rid(params.tenantId),
      alertMerge: params.alertMerge,
    },
  );
}

/**
 * Records a credit expense for reporting purposes only (no deduction).
 */
export async function upsertCreditExpense(params: {
  tenantId: string;
  resourceKey: string;
  amount: number;
  day: string;
  actorId: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPSERT credit_expense SET
      tenantIds = [$tenantId],
      resourceKey = $resourceKey,
      amount += $amount,
      count += 1,
      day = $day,
      actorId = $actorId
    WHERE tenantIds CONTAINS $tenantId
      AND resourceKey = $resourceKey
      AND day = $day`,
    {
      tenantId: rid(params.tenantId),
      resourceKey: params.resourceKey,
      amount: params.amount,
      day: params.day,
      actorId: params.actorId,
    },
  );
}

/**
 * Queries aggregated credit expenses for a tenant within a date range.
 */
export async function queryCreditExpenses(params: {
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<
  { resourceKey: string; totalAmount: number; totalCount: number }[]
> {
  const db = await getDb();
  const result = await db.query<
    [{ resourceKey: string; totalAmount: number; totalCount: number }[]]
  >(
    `SELECT resourceKey, math::sum(amount) AS totalAmount, math::sum(count) AS totalCount
     FROM credit_expense
     WHERE tenantIds CONTAINS $tenantId
       AND day >= $startDate
       AND day <= $endDate
     GROUP BY resourceKey
     ORDER BY totalAmount DESC`,
    {
      tenantId: rid(params.tenantId),
      startDate: params.startDate,
      endDate: params.endDate,
    },
  );
  return result[0] ?? [];
}
