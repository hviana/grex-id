import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("credits");

/**
 * Fetches the active subscription with auto-recharge guard,
 * and the purchased credit balance, in a single batched query.
 */
export async function fetchSubscriptionAndCreditBalance(params: {
  companyId: string;
  systemId: string;
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
      companyId: string;
      systemId: string;
      autoRechargeGuardSet: boolean;
    }[],
    { balance: number }[],
  ]
> {
  const db = await getDb();
  return db.query(
    `LET $sub = (SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId
     FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1)[0];
     IF $sub != NONE AND $sub.autoRechargeEnabled = true AND $sub.autoRechargeInProgress = false {
       UPDATE $sub.id SET autoRechargeInProgress = true;
     };
     SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId,
            (IF autoRechargeEnabled = true AND autoRechargeInProgress = false THEN true ELSE false END) AS autoRechargeGuardSet
     FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1;
     SELECT math::sum(value) AS balance FROM usage_record
     WHERE companyId = $companyId AND systemId = $systemId AND resource = "credits"
     GROUP ALL;`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
    },
  );
}

/**
 * Sets creditAlertSent=true on the subscription and fetches company owner + system info
 * for the insufficient-credit alert notification.
 */
export async function setCreditAlertAndFetchOwner(params: {
  subId: string;
  companyId: string;
  systemId: string;
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
     SELECT name, ownerId FROM company WHERE id = $companyId LIMIT 1;
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profile.name AS name, profile.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      subId: rid(params.subId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
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
  companyId: string;
  systemId: string;
  resourceKey: string;
  day: string;
  actorId: string | null;
  opCountMerge: Record<string, number> | null;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $subId SET remainingPlanCredits -= $amount${
      params.opCountMerge
        ? ", remainingOperationCount = object::merge(remainingOperationCount ?? {}, $opCountMerge)"
        : ""
    };
     UPSERT credit_expense SET
       companyId = $companyId, systemId = $systemId,
       resourceKey = $resourceKey, amount += $amount, count += 1, day = $day,
       actorId = $actorId
     WHERE companyId = $companyId AND systemId = $systemId
       AND resourceKey = $resourceKey AND day = $day;`,
    {
      subId: rid(params.subId),
      amount: params.amount,
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
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
  companyId: string;
  systemId: string;
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
        ? ", remainingOperationCount = object::merge(remainingOperationCount ?? {}, $opCountMerge)"
        : ""
    };
     UPSERT usage_record SET
       actorType = "user", actorId = "system",
       companyId = $companyId, systemId = $systemId,
       resource = "credits", value -= $fromPurchased, period = $period
     WHERE companyId = $companyId AND systemId = $systemId
       AND resource = "credits";
     UPSERT credit_expense SET
       companyId = $companyId, systemId = $systemId,
       resourceKey = $resourceKey, amount += $totalAmount, count += 1, day = $day,
       actorId = $actorId
     WHERE companyId = $companyId AND systemId = $systemId
       AND resourceKey = $resourceKey AND day = $day;`,
    {
      subId: rid(params.subId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
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
 * Returns the actor's maxOperationCount map and their current expense count.
 */
export async function fetchActorOperationCap(params: {
  actorRid: ReturnType<typeof rid>;
  actorStr: string;
  resourceKey: string;
  companyId: ReturnType<typeof rid>;
  systemId: ReturnType<typeof rid>;
  periodStart: string;
  actorType: string;
}): Promise<
  [
    (Record<string, number> | null)[],
    { count: number }[],
  ]
> {
  const db = await getDb();
  const actorQuery = params.actorType === "api_token"
    ? `SELECT VALUE maxOperationCount FROM api_token WHERE id = $actorRid LIMIT 1;`
    : `SELECT VALUE maxOperationCount FROM connected_app WHERE id = $actorRid LIMIT 1;`;

  return db.query(
    `${actorQuery}
     SELECT math::sum(count) AS count FROM credit_expense
     WHERE actorId = $actorStr
       AND resourceKey = $resourceKey
       AND companyId = $companyId
       AND systemId = $systemId
       AND day >= $periodStart
     GROUP ALL;`,
    {
      actorRid: params.actorRid,
      actorStr: params.actorStr,
      resourceKey: params.resourceKey,
      companyId: params.companyId,
      systemId: params.systemId,
      periodStart: params.periodStart,
    },
  );
}

/**
 * Sets the operation-count alert flag on the subscription and fetches
 * company owner + system info for the notification.
 */
export async function setOperationCountAlertAndFetchOwner(params: {
  subId: string;
  companyId: string;
  systemId: string;
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
    `UPDATE $subId SET operationCountAlertSent = object::merge(CASE WHEN operationCountAlertSent IS NONE OR operationCountAlertSent = false THEN {} ELSE operationCountAlertSent END, $alertMerge);
     LET $companyId = $cId;
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT id, profile.name AS name, profile.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      subId: rid(params.subId),
      cId: rid(params.companyId),
      systemId: rid(params.systemId),
      alertMerge: params.alertMerge,
    },
  );
}

/**
 * Records a credit expense for reporting purposes only (no deduction).
 */
export async function upsertCreditExpense(params: {
  companyId: string;
  systemId: string;
  resourceKey: string;
  amount: number;
  day: string;
  actorId: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPSERT credit_expense SET
      companyId = $companyId,
      systemId = $systemId,
      resourceKey = $resourceKey,
      amount += $amount,
      count += 1,
      day = $day,
      actorId = $actorId
    WHERE companyId = $companyId
      AND systemId = $systemId
      AND resourceKey = $resourceKey
      AND day = $day`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      resourceKey: params.resourceKey,
      amount: params.amount,
      day: params.day,
      actorId: params.actorId,
    },
  );
}

/**
 * Queries aggregated credit expenses for a company+system within a date range.
 */
export async function queryCreditExpenses(params: {
  companyId: string;
  systemId: string;
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
     WHERE companyId = $companyId
       AND systemId = $systemId
       AND day >= $startDate
       AND day <= $endDate
     GROUP BY resourceKey
     ORDER BY totalAmount DESC`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      startDate: params.startDate,
      endDate: params.endDate,
    },
  );
  return result[0] ?? [];
}
