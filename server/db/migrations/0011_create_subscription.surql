DEFINE TABLE subscription SCHEMAFULL;
DEFINE FIELD companyId          ON subscription TYPE record<company>;
DEFINE FIELD systemId           ON subscription TYPE record<system>;
DEFINE FIELD planId             ON subscription TYPE record<plan>;
DEFINE FIELD paymentMethodId        ON subscription TYPE option<record<payment_method>>;
DEFINE FIELD status                 ON subscription TYPE string
  ASSERT $value IN ["active", "past_due", "cancelled"];
DEFINE FIELD currentPeriodStart     ON subscription TYPE datetime;
DEFINE FIELD currentPeriodEnd       ON subscription TYPE datetime;
DEFINE FIELD voucherId              ON subscription TYPE option<record<voucher>>;
DEFINE FIELD remainingPlanCredits   ON subscription TYPE int DEFAULT 0;
DEFINE FIELD creditAlertSent        ON subscription TYPE bool DEFAULT false;
DEFINE FIELD autoRechargeEnabled    ON subscription TYPE option<bool> DEFAULT false;
DEFINE FIELD autoRechargeAmount     ON subscription TYPE option<int> DEFAULT 0;
DEFINE FIELD autoRechargeInProgress ON subscription TYPE option<bool> DEFAULT false;
DEFINE FIELD remainingOperationCount ON subscription TYPE option<object> FLEXIBLE;
DEFINE FIELD operationCountAlertSent ON subscription TYPE option<object> FLEXIBLE;
DEFINE FIELD createdAt              ON subscription TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sub_company_system ON subscription FIELDS companyId, systemId;
DEFINE INDEX idx_sub_status         ON subscription FIELDS status;
DEFINE INDEX idx_sub_period_end     ON subscription FIELDS currentPeriodEnd;
