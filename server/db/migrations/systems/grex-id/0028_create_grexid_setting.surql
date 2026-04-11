DEFINE TABLE grexid_setting SCHEMAFULL;
DEFINE FIELD companyId ON grexid_setting TYPE record<company>;
DEFINE FIELD systemId  ON grexid_setting TYPE record<system>;
DEFINE FIELD key       ON grexid_setting TYPE string;
DEFINE FIELD value     ON grexid_setting TYPE string;
DEFINE FIELD createdAt ON grexid_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON grexid_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_gs_unique ON grexid_setting FIELDS companyId, systemId, key UNIQUE;
