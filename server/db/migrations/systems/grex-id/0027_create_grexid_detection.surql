-- Grex-ID uses the shared location table
DEFINE TABLE grexid_detection SCHEMAFULL;
DEFINE FIELD locationId  ON grexid_detection TYPE record<location>;
DEFINE FIELD leadId      ON grexid_detection TYPE option<record<lead>>;
DEFINE FIELD score       ON grexid_detection TYPE float;
DEFINE FIELD detectedAt  ON grexid_detection TYPE datetime DEFAULT time::now();
DEFINE FIELD createdAt   ON grexid_detection TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_det_location      ON grexid_detection FIELDS locationId;
DEFINE INDEX idx_det_lead          ON grexid_detection FIELDS leadId;
DEFINE INDEX idx_det_date          ON grexid_detection FIELDS detectedAt;
DEFINE INDEX idx_det_location_date ON grexid_detection FIELDS locationId, detectedAt;
