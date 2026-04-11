DEFINE TABLE subscription SCHEMAFULL;
DEFINE FIELD companyId          ON subscription TYPE record<company>;
DEFINE FIELD systemId           ON subscription TYPE record<system>;
DEFINE FIELD planId             ON subscription TYPE record<plan>;
DEFINE FIELD paymentMethodId    ON subscription TYPE option<record<payment_method>>;
DEFINE FIELD status             ON subscription TYPE string
  ASSERT $value IN ["active", "past_due", "cancelled"];
DEFINE FIELD currentPeriodStart ON subscription TYPE datetime;
DEFINE FIELD currentPeriodEnd   ON subscription TYPE datetime;
DEFINE FIELD voucherIds         ON subscription TYPE array<record<voucher>>;
DEFINE FIELD createdAt          ON subscription TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sub_company_system ON subscription FIELDS companyId, systemId;
DEFINE INDEX idx_sub_status         ON subscription FIELDS status;
DEFINE INDEX idx_sub_period_end     ON subscription FIELDS currentPeriodEnd;
