DEFINE TABLE user SCHEMAFULL;
DEFINE FIELD passwordHash ON user TYPE string;
DEFINE FIELD profile      ON user TYPE record<profile>;
DEFINE FIELD roles        ON user TYPE array<string>;
DEFINE FIELD twoFactorEnabled ON user TYPE bool DEFAULT false;
DEFINE FIELD twoFactorSecret  ON user TYPE option<string>;
DEFINE FIELD oauthProvider    ON user TYPE option<string>;
DEFINE FIELD stayLoggedIn     ON user TYPE bool DEFAULT false;
DEFINE FIELD createdAt    ON user TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt    ON user TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_profile ON user FIELDS profile UNIQUE;
DEFINE INDEX idx_user_roles   ON user FIELDS roles;
