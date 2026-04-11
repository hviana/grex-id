DEFINE TABLE company_user SCHEMAFULL;
DEFINE FIELD companyId  ON company_user TYPE record<company>;
DEFINE FIELD userId     ON company_user TYPE record<user>;
DEFINE FIELD createdAt  ON company_user TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cu_unique ON company_user FIELDS companyId, userId UNIQUE;
DEFINE INDEX idx_cu_user   ON company_user FIELDS userId;
