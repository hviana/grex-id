DEFINE TABLE voucher SCHEMAFULL;
DEFINE FIELD name                  ON voucher TYPE string;
DEFINE FIELD applicableTenantIds  ON voucher TYPE array<record<tenant>> DEFAULT [];
DEFINE FIELD applicablePlanIds     ON voucher TYPE array<record<plan>> DEFAULT [];
DEFINE FIELD resourceLimitId         ON voucher TYPE record<resource_limit>;
DEFINE FIELD expiresAt             ON voucher TYPE option<datetime>;
DEFINE FIELD createdAt             ON voucher TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_voucher_name_fts ON TABLE voucher FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
DEFINE INDEX idx_voucher_name     ON voucher FIELDS name UNIQUE;
DEFINE INDEX idx_at_voucher_resource_limit        ON voucher FIELDS resourceLimitId;
