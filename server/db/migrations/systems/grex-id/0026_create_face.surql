DEFINE TABLE face SCHEMAFULL;
DEFINE FIELD leadId          ON face TYPE record<lead>;
DEFINE FIELD embedding_type1 ON face TYPE array<float, 1024>;
DEFINE FIELD createdAt       ON face TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt       ON face TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_face_lead ON face FIELDS leadId;
DEFINE INDEX face_embedding_type1_hnsw
  ON face
  FIELDS embedding_type1
  HNSW DIMENSION 1024 TYPE F32 DIST COSINE;
