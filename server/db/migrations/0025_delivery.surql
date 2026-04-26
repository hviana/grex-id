DEFINE TABLE delivery SCHEMAFULL;
DEFINE FIELD eventId     ON delivery TYPE record<queue_event>;
DEFINE FIELD handler     ON delivery TYPE string;
DEFINE FIELD status      ON delivery TYPE string
  ASSERT $value IN ["pending", "processing", "done", "dead"];
DEFINE FIELD availableAt ON delivery TYPE datetime;
DEFINE FIELD leaseUntil  ON delivery TYPE option<datetime>;
DEFINE FIELD attempts    ON delivery TYPE int DEFAULT 0;
DEFINE FIELD maxAttempts ON delivery TYPE int DEFAULT 5;
DEFINE FIELD lastError   ON delivery TYPE option<string>;
DEFINE FIELD workerId    ON delivery TYPE option<string>;
DEFINE FIELD createdAt   ON delivery TYPE datetime DEFAULT time::now();
DEFINE FIELD startedAt   ON delivery TYPE option<datetime>;
DEFINE FIELD finishedAt  ON delivery TYPE option<datetime>;

DEFINE INDEX idx_del_claim ON delivery FIELDS handler, status, availableAt, leaseUntil;
DEFINE INDEX idx_del_event_handler ON delivery FIELDS eventId, handler UNIQUE;
DEFINE INDEX idx_del_status_available ON delivery FIELDS status, availableAt;
