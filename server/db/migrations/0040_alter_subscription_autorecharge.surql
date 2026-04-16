-- Auto-recharge credits fields on subscription
DEFINE FIELD autoRechargeEnabled    ON subscription TYPE option<bool> DEFAULT false;
DEFINE FIELD autoRechargeAmount     ON subscription TYPE option<int> DEFAULT 0;
DEFINE FIELD autoRechargeInProgress ON subscription TYPE option<bool> DEFAULT false;
