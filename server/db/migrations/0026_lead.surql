DEFINE TABLE lead SCHEMAFULL;
DEFINE FIELD name          ON lead TYPE string;
DEFINE FIELD profileId     ON lead TYPE record<profile>;
DEFINE FIELD channelIds    ON lead TYPE set<record<entity_channel>> DEFAULT <set>[];
DEFINE FIELD tagIds        ON lead TYPE set<record<tag>> DEFAULT <set>[];
DEFINE FIELD tenantIds    On lead TYPE set<record<tenant>> DEFAULT <set>[];
DEFINE FIELD ownerIds     On lead TYPE set<record<user>> DEFAULT <set>[];
DEFINE FIELD acceptsCommunication ON lead TYPE bool DEFAULT false;
DEFINE FIELD createdAt     ON lead TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt     ON lead TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_lead_profileId  ON lead FIELDS profileId UNIQUE;
DEFINE INDEX idx_lead_ids  ON lead FIELDS channelIds, tagIds, tenantIds, ownerIds, acceptsCommunication;

DEFINE INDEX idx_lead_name     ON lead FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
