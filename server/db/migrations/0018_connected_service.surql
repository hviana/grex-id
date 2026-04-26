DEFINE TABLE connected_service SCHEMAFULL;
DEFINE FIELD tenantIds ON connected_service TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD name      ON connected_service TYPE string;
DEFINE FIELD data      ON connected_service TYPE option<object> FLEXIBLE;
DEFINE FIELD createdAt ON connected_service TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_tenant ON connected_service FIELDS tenantIds;
DEFINE INDEX idx_cs_name_fts ON connected_service FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
