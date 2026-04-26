DEFINE TABLE credit_purchase SCHEMAFULL;
DEFINE FIELD tenantId       ON credit_purchase TYPE record<tenant>;
DEFINE FIELD amount          ON credit_purchase TYPE int;
DEFINE FIELD paymentMethodId ON credit_purchase TYPE record<payment_method>;
DEFINE FIELD status          ON credit_purchase TYPE string
  ASSERT $value IN ["pending", "completed", "failed", "expired"];
DEFINE FIELD subscriptionId  ON credit_purchase TYPE option<record<subscription>>;
DEFINE FIELD createdAt       ON credit_purchase TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cp_tenant ON credit_purchase FIELDS tenantId;
DEFINE INDEX idx_cp_subscription ON credit_purchase FIELDS subscriptionId;
