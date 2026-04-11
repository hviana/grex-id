DEFINE TABLE company_system SCHEMAFULL;
DEFINE FIELD companyId ON company_system TYPE record<company>;
DEFINE FIELD systemId  ON company_system TYPE record<system>;
DEFINE FIELD createdAt ON company_system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_unique ON company_system FIELDS companyId, systemId UNIQUE;
