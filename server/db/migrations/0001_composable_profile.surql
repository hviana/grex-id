DEFINE TABLE profile SCHEMAFULL;
DEFINE FIELD name              ON profile TYPE string;
DEFINE FIELD avatarUri         ON profile TYPE option<string>;
DEFINE FIELD dateOfBirth ON profile TYPE option<datetime>;
DEFINE FIELD locale            ON profile TYPE option<string>;
DEFINE FIELD recoveryChannelIds ON profile TYPE set<record<entity_channel>> DEFAULT <set>[];
DEFINE FIELD createdAt         ON profile TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt         ON profile TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_profile_name ON TABLE profile FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
