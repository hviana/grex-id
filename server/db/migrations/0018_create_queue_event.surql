DEFINE TABLE queue_event SCHEMAFULL;
DEFINE FIELD name        ON queue_event TYPE string;
DEFINE FIELD payload ON queue_event TYPE object FLEXIBLE;
DEFINE FIELD availableAt ON queue_event TYPE datetime;
DEFINE FIELD createdAt   ON queue_event TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_qe_available       ON queue_event FIELDS availableAt;
DEFINE INDEX idx_qe_name_available  ON queue_event FIELDS name, availableAt;
