DEFINE TABLE role SCHEMAFULL;
DEFINE FIELD name        ON role TYPE string;
DEFINE FIELD tenantIds   ON role TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD isBuiltIn   ON role TYPE bool DEFAULT false;
DEFINE FIELD createdAt   ON role TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON role TYPE option<datetime>;

DEFINE INDEX idx_role_tenant      ON role FIELDS tenantIds;
DEFINE INDEX idx_role_name_tenant ON role FIELDS name, tenantIds UNIQUE;
DEFINE INDEX idx_role_name_fts    ON role FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
