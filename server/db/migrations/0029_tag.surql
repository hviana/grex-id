DEFINE TABLE tag SCHEMAFULL;
DEFINE FIELD name      ON tag TYPE string;
DEFINE FIELD color     ON tag TYPE string;
DEFINE FIELD tenantId  ON tag TYPE record<tenant>;
DEFINE FIELD createdAt ON tag TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tag_tenant      ON tag FIELDS tenantId;
DEFINE INDEX idx_tag_name_tenant ON tag FIELDS name, tenantId UNIQUE;
DEFINE INDEX idx_tag_name        ON TABLE tag FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
