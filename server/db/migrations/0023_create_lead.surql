DEFINE TABLE lead SCHEMAFULL;
DEFINE FIELD name          ON lead TYPE string;
DEFINE FIELD profileId     ON lead TYPE record<profile>;
DEFINE FIELD channelIds    ON lead TYPE array<record<entity_channel>> DEFAULT [];
DEFINE FIELD tagIds        ON lead TYPE array<record<tag>> DEFAULT [];
DEFINE FIELD companyIds    ON lead TYPE array<record<company>> DEFAULT [];
DEFINE FIELD createdAt     ON lead TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt     ON lead TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_lead_profile  ON lead FIELDS profileId UNIQUE;
DEFINE INDEX idx_lead_channels ON lead FIELDS channelIds;
DEFINE INDEX idx_lead_name     ON TABLE lead FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
