DEFINE TABLE group SCHEMAFULL;

DEFINE FIELD name        ON group TYPE string;
DEFINE FIELD description ON group TYPE option<string>;
DEFINE FIELD tenantIds   ON group TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD createdAt   ON group TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON group TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_group_tenant     ON group FIELDS tenantIds;
DEFINE INDEX idx_group_name_fts   ON group FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
DEFINE INDEX idx_group_name_tenant ON group FIELDS name, tenantIds UNIQUE;
