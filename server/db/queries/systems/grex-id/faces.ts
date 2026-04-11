import { getDb, rid } from "@/server/db/connection";

export interface Face {
  id: string;
  leadId: string;
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
): Promise<{ id: string; leadId: string; score: number }[]> {
  const db = await getDb();
  const result = await db.query<
    [{ id: string; leadId: string; score: number }[]]
  >(
    `LET $q = $embedding;
     SELECT id, leadId, vector::distance::knn() AS score
     FROM face
     WHERE embedding_type1 <|${limit},${candidates}|> $q
     ORDER BY score`,
    { embedding },
  );
  return result[0] ?? [];
}

export async function deleteFaceByLeadId(leadId: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM face WHERE leadId = $leadId", {
    leadId: rid(leadId),
  });
}
