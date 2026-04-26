DEFINE TABLE subscription SCHEMAFULL;
DEFINE FIELD tenantIds              ON subscription TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD planId                 ON subscription TYPE record<plan>;
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
DEFINE FIELD retryPaymentInProgress ON subscription TYPE bool DEFAULT false;
DEFINE FIELD createdAt              ON subscription TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt              ON subscription TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sub_tenant          ON subscription FIELDS tenantIds;
DEFINE INDEX idx_sub_tenant_status   ON subscription FIELDS tenantIds, status;
DEFINE INDEX idx_sub_status          ON subscription FIELDS status;
DEFINE INDEX idx_sub_period_end      ON subscription FIELDS currentPeriodEnd;
DEFINE INDEX idx_sub_status_period   ON subscription FIELDS status, currentPeriodEnd;
DEFINE INDEX idx_sub_voucher         ON subscription FIELDS voucherId;
DEFINE INDEX idx_sub_plan            ON subscription FIELDS planId;
DEFINE INDEX idx_sub_updated         ON subscription FIELDS updatedAt;
