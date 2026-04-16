DEFINE TABLE lead SCHEMAFULL;
DEFINE FIELD name          ON lead TYPE string;
DEFINE FIELD email         ON lead TYPE string ASSERT string::is_email($value);
DEFINE FIELD phone         ON lead TYPE option<string>;
DEFINE FIELD profile       ON lead TYPE record<profile>;
DEFINE FIELD tags          ON lead TYPE array<record<tag>> DEFAULT [];
DEFINE FIELD companyIds    ON lead TYPE array<record<company>> DEFAULT [];
DEFINE FIELD createdAt     ON lead TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt     ON lead TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_lead_email ON lead FIELDS email UNIQUE;
DEFINE INDEX idx_lead_phone ON lead FIELDS phone UNIQUE;
DEFINE INDEX idx_lead_name  ON TABLE lead FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
