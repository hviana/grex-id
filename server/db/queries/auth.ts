import { getDb, rid } from "../connection";
import type { User } from "@/src/contracts/user";

export type VerificationRequestType =
  | "email_verify"
  | "phone_verify"
  | "password_reset"
  | "lead_update";

export interface VerificationRequestRecord {
  id: string;
  userId: string;
  type: VerificationRequestType;
  expiresAt: string;
  usedAt: string | null;
  payload?: Record<string, unknown> | null;
}

function isRecordId(value: string): boolean {
  return /^[^:\s]+:[^:\s]+$/.test(value);
}

function normalizeRecordId(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value.trim() || null;
  }

  const stringified = String(value).trim();
  if (isRecordId(stringified)) {
    return stringified;
  }

  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string" && typeof record.id === "string") {
      return `${record.tb}:${record.id}`;
    }
    if (typeof record.id === "string") {
      const recordId = record.id.trim();
      return recordId || null;
    }
  }

  return stringified || null;
}

function requireRecordId(value: unknown, field: string): string {
  const id = normalizeRecordId(value);
  if (!id || !isRecordId(id)) {
    throw new Error(`INVALID_RECORD_ID:${field}`);
  }
  return id;
}

function normalizeVerificationRequest(
  request: VerificationRequestRecord | null,
): VerificationRequestRecord | null {
  if (!request) return request;

  return {
    ...request,
    id: normalizeRecordId(request.id) ?? request.id,
    userId: normalizeRecordId(request.userId) ?? request.userId,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  const result = await db.query<[User[]]>(
    "SELECT * FROM user WHERE email = $email LIMIT 1 FETCH profile",
    { email },
  );
  return result[0]?.[0] ?? null;
}

export async function verifyPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const db = await getDb();
  const result = await db.query<[{ valid: boolean }[]]>(
    `SELECT crypto::argon2::compare(passwordHash, $password) AS valid
     FROM user WHERE email = $email LIMIT 1`,
    { email, password },
  );
  return result[0]?.[0]?.valid === true;
}

export async function createUser(params: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  locale?: string;
}): Promise<User> {
  const db = await getDb();
  const result = await db.query<[unknown, unknown, User[]]>(
    `LET $prof = CREATE profile SET
      name = $name,
      locale = $locale;
    LET $usr = CREATE user SET
      email = $email,
      passwordHash = crypto::argon2::generate($password),
      profile = $prof[0].id,
      phone = $phone,
      roles = ["viewer"],
      emailVerified = false,
      twoFactorEnabled = false,
      stayLoggedIn = false;
    SELECT * FROM $usr[0].id FETCH profile;`,
    {
      name: params.name,
      locale: params.locale ?? undefined,
      email: params.email,
      password: params.password,
      phone: params.phone ?? undefined,
    },
  );
  return result[2][0];
}

export async function markEmailVerified(userId: string): Promise<void> {
  const db = await getDb();
  const normalizedUserId = requireRecordId(userId, "userId");
  await db.query(
    "UPDATE $userId SET emailVerified = true, updatedAt = time::now()",
    { userId: rid(normalizedUserId) },
  );
}

export async function updatePassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const db = await getDb();
  const normalizedUserId = requireRecordId(userId, "userId");
  await db.query(
    "UPDATE $userId SET passwordHash = crypto::argon2::generate($password), updatedAt = time::now()",
    { userId: rid(normalizedUserId), password: newPassword },
  );
}

export async function createVerificationRequest(params: {
  userId: string;
  type: VerificationRequestType;
  token: string;
  expiresAt: Date;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  const normalizedUserId = requireRecordId(params.userId, "userId");
  await db.query(
    `CREATE verification_request SET
      userId = $userId,
      type = $type,
      token = $verificationToken,
      expiresAt = $expiresAt,
      payload = $payload`,
    {
      userId: rid(normalizedUserId),
      type: params.type,
      verificationToken: params.token,
      expiresAt: params.expiresAt,
      payload: params.payload ?? undefined,
    },
  );
}

export async function findVerificationRequest(
  token: string,
): Promise<VerificationRequestRecord | null> {
  const db = await getDb();
  const result = await db.query<[VerificationRequestRecord[]]>(
    "SELECT * FROM verification_request WHERE token = $verificationToken LIMIT 1",
    { verificationToken: token },
  );
  return normalizeVerificationRequest(result[0]?.[0] ?? null);
}

export async function markVerificationUsed(requestId: string): Promise<void> {
  const db = await getDb();
  const normalizedRequestId = requireRecordId(requestId, "requestId");
  await db.query(
    "UPDATE $requestId SET usedAt = time::now()",
    { requestId: rid(normalizedRequestId) },
  );
}

export async function getLastVerificationRequest(userId: string, type: string) {
  const db = await getDb();
  const normalizedUserId = requireRecordId(userId, "userId");
  const result = await db.query<[{ createdAt: string }[]]>(
    `SELECT createdAt FROM verification_request
     WHERE userId = $userId AND type = $type
     ORDER BY createdAt DESC LIMIT 1`,
    { userId: rid(normalizedUserId), type },
  );
  return result[0]?.[0] ?? null;
}
