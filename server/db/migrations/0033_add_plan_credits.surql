-- Add planCredits field to plan table
DEFINE FIELD planCredits ON plan TYPE int DEFAULT 0;

-- Add remainingPlanCredits and creditAlertSent fields to subscription table
DEFINE FIELD remainingPlanCredits ON subscription TYPE int DEFAULT 0;
DEFINE FIELD creditAlertSent ON subscription TYPE bool DEFAULT false;
