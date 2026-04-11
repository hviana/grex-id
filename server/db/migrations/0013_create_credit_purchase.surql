DEFINE TABLE credit_purchase SCHEMAFULL;
DEFINE FIELD companyId       ON credit_purchase TYPE record<company>;
DEFINE FIELD systemId        ON credit_purchase TYPE record<system>;
DEFINE FIELD amount          ON credit_purchase TYPE int;
DEFINE FIELD paymentMethodId ON credit_purchase TYPE record<payment_method>;
DEFINE FIELD status          ON credit_purchase TYPE string
  ASSERT $value IN ["pending", "completed", "failed"];
DEFINE FIELD createdAt       ON credit_purchase TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cp_company_system ON credit_purchase FIELDS companyId, systemId;
