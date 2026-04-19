-- Remove old per-type verification/expiry/cooldown settings
-- Replaced by unified auth.communication.* settings (see verification-guard.ts §12.13)
DELETE FROM setting WHERE key = "auth.verification.cooldown.seconds" AND systemSlug IS NONE;
DELETE FROM setting WHERE key = "auth.verification.expiry.minutes" AND systemSlug IS NONE;
DELETE FROM setting WHERE key = "auth.passwordReset.expiry.minutes" AND systemSlug IS NONE;
DELETE FROM setting WHERE key = "auth.recoveryChannel.verification.expiry.minutes" AND systemSlug IS NONE;
