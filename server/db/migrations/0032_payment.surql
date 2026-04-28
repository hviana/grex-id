DEFINE TABLE payment SCHEMAFULL;
DEFINE FIELD tenantIds       On payment TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD subscriptionId  ON payment TYPE record<subscription>;
DEFINE FIELD amount          ON payment TYPE int;
DEFINE FIELD currency        ON payment TYPE string DEFAULT "USD";
DEFINE FIELD kind            ON payment TYPE string
  ASSERT $value IN ["recurring", "credits", "auto-recharge"];
DEFINE FIELD status          ON payment TYPE string
  ASSERT $value IN ["pending", "completed", "failed", "expired"];
DEFINE FIELD paymentMethodId ON payment TYPE record<payment_method>;
DEFINE FIELD transactionId   ON payment TYPE option<string>;
DEFINE FIELD invoiceUrl      ON payment TYPE option<string>;
DEFINE FIELD failureReason   ON payment TYPE option<string>;
DEFINE FIELD continuityData  ON payment TYPE option<object> FLEXIBLE;
DEFINE FIELD expiresAt       ON payment TYPE option<datetime>;
DEFINE FIELD createdAt       ON payment TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_payment_tenant    ON payment FIELDS tenantIds;
DEFINE INDEX idx_payment_created   ON payment FIELDS createdAt;
DEFINE INDEX idx_payment_kind      ON payment FIELDS kind;
DEFINE INDEX idx_payment_expires   ON payment FIELDS status, expiresAt;
DEFINE INDEX idx_payment_transaction ON payment FIELDS transactionId;
