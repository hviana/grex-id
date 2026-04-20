-- Per-resourceKey operation counts (§8, §12.3, §22.3)

-- subscription.remainingOperationCount: int → per-resourceKey map
DEFINE FIELD remainingOperationCount ON subscription TYPE option<object> FLEXIBLE;

-- subscription.operationCountAlertSent: bool → per-resourceKey alert map
DEFINE FIELD operationCountAlertSent ON subscription TYPE option<object> FLEXIBLE;

-- api_token: per-resourceKey operation count cap
DEFINE FIELD maxOperationCount ON api_token TYPE option<object> FLEXIBLE;

-- connected_app: per-resourceKey operation count cap
DEFINE FIELD maxOperationCount ON connected_app TYPE option<object> FLEXIBLE;

-- credit_expense: add actorId for per-actor operation count tracking
DEFINE FIELD actorId ON credit_expense TYPE option<string>;
DEFINE INDEX idx_ce_actor_resource ON credit_expense FIELDS actorId, resourceKey, day;
