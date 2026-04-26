DEFINE TABLE lead_company_system SCHEMAFULL;
DEFINE FIELD leadId    ON lead_company_system TYPE record<lead>;
DEFINE FIELD companyId ON lead_company_system TYPE record<company>;
DEFINE FIELD systemId  ON lead_company_system TYPE record<system>;
DEFINE FIELD ownerId   ON lead_company_system TYPE option<record<user>>;
DEFINE FIELD createdAt ON lead_company_system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_lcs_unique  ON lead_company_system FIELDS leadId, companyId, systemId UNIQUE;
DEFINE INDEX idx_lcs_company ON lead_company_system FIELDS companyId, systemId;
DEFINE INDEX idx_lcs_lead    ON lead_company_system FIELDS leadId;
DEFINE INDEX idx_lcs_owner   ON lead_company_system FIELDS ownerId;
