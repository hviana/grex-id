-- Grex-ID uses the shared location table
DEFINE TABLE grexid_detection SCHEMAFULL;
DEFINE FIELD locationId  ON grexid_detection TYPE record<location>;
DEFINE FIELD leadId      ON grexid_detection TYPE option<record<lead>>;
DEFINE FIELD faceId      ON grexid_detection TYPE option<record<face>>;
DEFINE FIELD score       ON grexid_detection TYPE float;
DEFINE FIELD eventId     ON grexid_detection TYPE option<string>;
DEFINE FIELD detectedAt  ON grexid_detection TYPE datetime DEFAULT time::now();
DEFINE FIELD createdAt   ON grexid_detection TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_det_location      ON grexid_detection FIELDS locationId;
DEFINE INDEX idx_det_lead          ON grexid_detection FIELDS leadId;
DEFINE INDEX idx_det_face          ON grexid_detection FIELDS faceId;
DEFINE INDEX idx_det_date          ON grexid_detection FIELDS detectedAt;
DEFINE INDEX idx_det_location_date ON grexid_detection FIELDS locationId, detectedAt;
DEFINE INDEX idx_det_event         ON grexid_detection FIELDS eventId;
DEFINE INDEX idx_det_location_event ON grexid_detection FIELDS locationId, eventId;
