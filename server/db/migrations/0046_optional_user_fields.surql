-- Allow users without a profile (anonymous user) and without a password.
DEFINE FIELD profileId    ON user TYPE option<record<profile>>;
DEFINE FIELD passwordHash ON user TYPE option<string>;

-- Fix: roleIds must reference the role table, not the system table.
DEFINE FIELD roleIds ON user_company_system TYPE array<record<role>> DEFAULT [];
