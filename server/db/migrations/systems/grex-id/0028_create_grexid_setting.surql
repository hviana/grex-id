DEFINE TABLE grexid_setting SCHEMAFULL;
DEFINE FIELD tenantId ON grexid_setting TYPE record<tenant>;
DEFINE FIELD key       ON grexid_setting TYPE string;
DEFINE FIELD value     ON grexid_setting TYPE string;
DEFINE FIELD createdAt ON grexid_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON grexid_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_gs_unique ON grexid_setting FIELDS tenantId, key UNIQUE;
