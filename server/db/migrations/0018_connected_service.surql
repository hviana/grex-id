DEFINE TABLE connected_service SCHEMAFULL;
DEFINE FIELD tenantId ON connected_service TYPE record<tenant>;
DEFINE FIELD name      ON connected_service TYPE string;
DEFINE FIELD data      ON connected_service TYPE option<object> FLEXIBLE;
DEFINE FIELD createdAt ON connected_service TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_tenant ON connected_service FIELDS tenantId;
DEFINE INDEX idx_cs_name_fts ON connected_service FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
