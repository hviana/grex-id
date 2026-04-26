DEFINE TABLE system SCHEMAFULL;
DEFINE FIELD name           ON system TYPE string;
DEFINE FIELD slug           ON system TYPE string;
DEFINE FIELD logoUri        ON system TYPE string;
DEFINE FIELD defaultLocale  ON system TYPE option<string>;
DEFINE FIELD termsOfService ON system TYPE option<string>;
DEFINE FIELD createdAt      ON system TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt      ON system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_system_slug ON system FIELDS slug UNIQUE;
DEFINE INDEX idx_system_name ON TABLE system FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
