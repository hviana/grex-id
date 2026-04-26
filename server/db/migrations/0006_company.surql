DEFINE TABLE company SCHEMAFULL;
DEFINE FIELD name           ON company TYPE string;
DEFINE FIELD document       ON company TYPE string;
DEFINE FIELD documentType   ON company TYPE string;
DEFINE FIELD billingAddressId ON company TYPE option<record<address>>;
DEFINE FIELD createdAt      ON company TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt      ON company TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_company_name     ON TABLE company FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
DEFINE INDEX idx_company_document ON company FIELDS document UNIQUE;
