DEFINE TABLE user SCHEMAFULL;
DEFINE FIELD passwordHash ON user TYPE string;
DEFINE FIELD profileId    ON user TYPE record<profile>;
DEFINE FIELD channelIds   ON user TYPE array<record<entity_channel>> DEFAULT [];
DEFINE FIELD roles        ON user TYPE array<string>;
DEFINE FIELD twoFactorEnabled        ON user TYPE bool DEFAULT false;
DEFINE FIELD twoFactorSecret         ON user TYPE option<string>;
DEFINE FIELD pendingTwoFactorSecret  ON user TYPE option<string>;
DEFINE FIELD stayLoggedIn     ON user TYPE bool DEFAULT false;
DEFINE FIELD createdAt    ON user TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt    ON user TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_profile  ON user FIELDS profileId UNIQUE;
DEFINE INDEX idx_user_channels ON user FIELDS channelIds;
DEFINE INDEX idx_user_roles    ON user FIELDS roles;

DEFINE TABLE oauth_identity SCHEMAFULL;
DEFINE FIELD userId         ON oauth_identity TYPE record<user>;
DEFINE FIELD provider       ON oauth_identity TYPE string ASSERT $value != "";
DEFINE FIELD providerUserId ON oauth_identity TYPE string ASSERT $value != "";
DEFINE FIELD linkedAt       ON oauth_identity TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_oauth_identity_provider_user ON oauth_identity FIELDS provider, providerUserId UNIQUE;
DEFINE INDEX idx_oauth_identity_user          ON oauth_identity FIELDS userId;
