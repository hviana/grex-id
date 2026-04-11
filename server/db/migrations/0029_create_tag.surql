DEFINE TABLE tag SCHEMAFULL;
DEFINE FIELD name      ON tag TYPE string;
DEFINE FIELD color     ON tag TYPE string;
DEFINE FIELD companyId ON tag TYPE record<company>;
DEFINE FIELD systemId  ON tag TYPE record<system>;
DEFINE FIELD createdAt ON tag TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tag_company_system      ON tag FIELDS companyId, systemId;
DEFINE INDEX idx_tag_name_company_system ON tag FIELDS name, companyId, systemId UNIQUE;
DEFINE INDEX idx_tag_name                ON TABLE tag FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
