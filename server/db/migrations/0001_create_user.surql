DEFINE TABLE user SCHEMAFULL;
DEFINE FIELD email        ON user TYPE string  ASSERT string::is_email($value);
DEFINE FIELD emailVerified ON user TYPE bool   DEFAULT false;
DEFINE FIELD phone        ON user TYPE option<string>;
DEFINE FIELD phoneVerified ON user TYPE bool   DEFAULT false;
DEFINE FIELD passwordHash ON user TYPE string;
DEFINE FIELD profile      ON user TYPE record<profile>;
DEFINE FIELD roles        ON user TYPE array<string>;
DEFINE FIELD twoFactorEnabled ON user TYPE bool DEFAULT false;
DEFINE FIELD twoFactorSecret  ON user TYPE option<string>;
DEFINE FIELD oauthProvider    ON user TYPE option<string>;
DEFINE FIELD stayLoggedIn     ON user TYPE bool DEFAULT false;
DEFINE FIELD createdAt    ON user TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt    ON user TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_email ON user FIELDS email UNIQUE;
DEFINE INDEX idx_user_phone ON user FIELDS phone UNIQUE;
DEFINE INDEX idx_user_roles ON user FIELDS roles;
