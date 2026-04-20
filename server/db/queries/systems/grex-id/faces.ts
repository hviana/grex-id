import { getDb, rid } from "@/server/db/connection";

function normalizeRecordId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return value.trim() || null;
  }
  const stringified = String(value).trim();
  if (/^[^:\s]+:[^:\s]+$/.test(stringified)) {
    return stringified;
  }
  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string") {
      const innerId = typeof record.id === "string"
        ? record.id
        : record.id != null
        ? String((record.id as { String?: string }).String ?? record.id)
        : "";
      if (innerId) return `${record.tb}:${innerId}`;
    }
    if (typeof record.id === "string") {
      return record.id.trim() || null;
    }
  }
  return stringified || null;
}

export interface Face {
  id: string;
  leadId?: string;
  embedding_type1: number[];
  createdAt: string;
  updatedAt: string;
}

export async function getFaceByLeadId(leadId: string): Promise<Face | null> {
  const db = await getDb();
  const result = await db.query<[Face[]]>(
    "SELECT * FROM face WHERE leadId = $leadId LIMIT 1",
    { leadId: rid(leadId) },
  );
  return result[0]?.[0] ?? null;
}

export async function upsertFace(data: {
  leadId: string;
  embedding_type1: number[];
}): Promise<Face> {
  const db = await getDb();

  const existing = await getFaceByLeadId(data.leadId);

  if (existing) {
    const result = await db.query<[Face[]]>(
      `UPDATE $id SET
        embedding_type1 = $embedding,
        updatedAt = time::now()`,
      {
        id: rid(existing.id),
        embedding: data.embedding_type1,
      },
    );
    return result[0][0];
  }

  const result = await db.query<[Face[]]>(
    `CREATE face SET
      leadId = $leadId,
      embedding_type1 = $embedding`,
    {
      leadId: rid(data.leadId),
      embedding: data.embedding_type1,
    },
  );
  return result[0][0];
}

export async function tryUpsertFace(
  data: {
    leadId: string;
    embedding_type1: number[];
  },
  meta?: Record<string, unknown>,
): Promise<Face | null> {
  try {
    return await upsertFace(data);
  } catch (error) {
    console.error("grex-id face upsert failed", {
      leadId: data.leadId,
      embeddingLength: Array.isArray(data.embedding_type1)
        ? data.embedding_type1.length
        : undefined,
      ...meta,
      error,
    });
    return null;
  }
}

export async function searchFaceByEmbedding(
  embedding: number[],
  limit: number = 1,
  candidates: number = 40,
): Promise<{ id: string; leadId: string | null; score: number }[]> {
  const db = await getDb();
  const result = await db.query<
    [{ id: unknown; leadId: unknown; score: number }[]]
  >(
    `SELECT id, leadId, vector::distance::knn() AS score
     FROM face
     WHERE embedding_type1 <|${limit},${candidates}|> $embedding
     ORDER BY score`,
    { embedding },
  );
  const rows = result[0] ?? [];
  return rows
    .map((row) => {
      const id = normalizeRecordId(row.id);
      if (!id) return null;
      return { id, leadId: normalizeRecordId(row.leadId), score: row.score };
    })
    .filter((row): row is { id: string; leadId: string | null; score: number } =>
      row !== null
    );
}

export async function deleteFaceByLeadId(leadId: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM face WHERE leadId = $leadId", {
    leadId: rid(leadId),
  });
}

export async function createOrphanFace(embedding: number[]): Promise<Face> {
  const db = await getDb();
  const result = await db.query<[Face[]]>(
    `CREATE face SET
      leadId = NONE,
      embedding_type1 = $embedding`,
    { embedding },
  );
  return result[0][0];
}

export async function linkOrphanFaceToLead(
  faceId: string,
  leadId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $faceId SET leadId = $leadId, updatedAt = time::now()`,
    { faceId: rid(faceId), leadId: rid(leadId) },
  );
}

export async function searchOrphanFaceByEmbedding(
  embedding: number[],
  sensitivity: number,
  limit: number = 1,
  candidates: number = 40,
): Promise<{ id: string; score: number }[]> {
  const db = await getDb();
  const result = await db.query<
    [{ id: unknown; score: number }[]]
  >(
    `SELECT id, vector::distance::knn() AS score
     FROM face
     WHERE leadId IS NONE
       AND embedding_type1 <|${limit},${candidates}|> $embedding
     ORDER BY score`,
    { embedding },
  );
  const rows = result[0] ?? [];
  return rows
    .map((row) => {
      const id = normalizeRecordId(row.id);
      if (!id || row.score < sensitivity) return null;
      return { id, score: row.score };
    })
    .filter((row): row is { id: string; score: number } => row !== null);
}
