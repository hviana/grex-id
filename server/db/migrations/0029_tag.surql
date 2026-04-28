DEFINE TABLE tag SCHEMAFULL;
DEFINE FIELD name      ON tag TYPE string;
DEFINE FIELD color     ON tag TYPE string;
DEFINE FIELD tenantIds On tag TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD createdAt ON tag TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tag_tenant      On tag FIELDS tenantIds;
DEFINE INDEX idx_tag_name_tenant On tag FIELDS name, tenantIds UNIQUE;
DEFINE INDEX idx_tag_name        ON TABLE tag FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
