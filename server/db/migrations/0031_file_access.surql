DEFINE TABLE file_access SCHEMAFULL;
DEFINE FIELD name            ON file_access TYPE string;
DEFINE FIELD categoryPattern ON file_access TYPE string;
DEFINE FIELD download        ON file_access TYPE object FLEXIBLE;
DEFINE FIELD upload          ON file_access TYPE object FLEXIBLE;
DEFINE FIELD createdAt       ON file_access TYPE datetime DEFAULT time::now();
DEFINE FIELD tenantIds    ON user TYPE array<record<tenant>> DEFAULT [];

DEFINE INDEX idx_fa_name ON file_access FIELDS name UNIQUE;
DEFINE INDEX idx_fa_name_fts ON TABLE file_access FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
