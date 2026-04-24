DEFINE TABLE connected_service SCHEMAFULL;
DEFINE FIELD userId    ON connected_service TYPE record<user>;
DEFINE FIELD companyId ON connected_service TYPE record<company>;
DEFINE FIELD systemId  ON connected_service TYPE record<system>;
DEFINE FIELD name      ON connected_service TYPE string;
DEFINE FIELD data      ON connected_service TYPE option<object> FLEXIBLE;
DEFINE FIELD createdAt ON connected_service TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_company_system      ON connected_service FIELDS companyId, systemId;
DEFINE INDEX idx_cs_company_system_user ON connected_service FIELDS companyId, systemId, userId;
DEFINE INDEX idx_cs_name_fts            ON connected_service FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
