DEFINE TABLE user_company_system SCHEMAFULL;
DEFINE FIELD userId    ON user_company_system TYPE record<user>;
DEFINE FIELD companyId ON user_company_system TYPE record<company>;
DEFINE FIELD systemId  ON user_company_system TYPE record<system>;
DEFINE FIELD roles     ON user_company_system TYPE array<string>;
DEFINE FIELD createdAt ON user_company_system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ucs_unique  ON user_company_system FIELDS userId, companyId, systemId UNIQUE;
DEFINE INDEX idx_ucs_user    ON user_company_system FIELDS userId;
DEFINE INDEX idx_ucs_company ON user_company_system FIELDS companyId;
