-- Older databases may still have this field typed as record<grexid_location>.
-- Grex-ID now uses the shared location table, so keep the persisted schema aligned.
DEFINE FIELD locationId ON grexid_detection TYPE record<location>;
