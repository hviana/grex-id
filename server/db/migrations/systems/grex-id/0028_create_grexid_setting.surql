DEFINE TABLE grexid_setting SCHEMAFULL;
DEFINE FIELD tenantIds ON grexid_setting TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD key       ON grexid_setting TYPE string;
DEFINE FIELD value     ON grexid_setting TYPE string;
DEFINE FIELD createdAt ON grexid_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON grexid_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_gs_unique ON grexid_setting FIELDS tenantIds, key UNIQUE;
